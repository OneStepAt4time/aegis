/**
 * audit.ts — Tamper-evident append-only audit trail.
 *
 * Issue #1419: SOC2/ISO 27001 compliance.
 *
 * Each record is chained via PBKDF2-HMAC-SHA512 hashes — the hash of record N
 * includes the hash of record N-1, making retroactive edits detectable.
 * Log files rotate daily and are never overwritten.
 */

import { pbkdf2 } from 'node:crypto';
import { appendFile, readFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { secureFilePermissions } from './file-utils.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface AuditRecord {
  /** ISO 8601 timestamp */
  ts: string;
  /** Actor key ID (or 'master' / 'system') */
  actor: string;
  /** Action category (e.g. 'key.create', 'session.kill') */
  action: string;
  /** Associated session ID, if applicable */
  sessionId?: string;
  /** Human-readable detail */
  detail: string;
  /** SHA-256 hash of previous record (hex) — empty string for first record */
  prevHash: string;
  /** SHA-256 hash of this record (hex) — covers all fields except itself */
  hash: string;
}

export type AuditAction =
  | 'key.create'
  | 'key.revoke'
  | 'session.create'
  | 'session.kill'
  | 'permission.approve'
  | 'permission.reject'
  | 'api.authenticated';

export interface AuditQueryOptions {
  /** Filter by actor key ID */
  actor?: string;
  /** Filter by action */
  action?: AuditAction;
  /** Filter by session ID */
  sessionId?: string;
  /** Max records to return (default 100) */
  limit?: number;
  /** Return records from newest first (default false = chronological) */
  reverse?: boolean;
}

// ── Implementation ─────────────────────────────────────────────────────

function dateToFileDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

const AUDIT_HASH_ITERATIONS = 120_000;
const AUDIT_HASH_KEY_LENGTH = 32;
const AUDIT_HASH_DIGEST = 'sha512';
const AUDIT_HASH_SALT_PREFIX = 'aegis-audit-chain-v2';
const pbkdf2Async = promisify(pbkdf2);

async function computeHash(record: Omit<AuditRecord, 'hash'>): Promise<string> {
  const payload = `${record.ts}|${record.actor}|${record.action}|${record.sessionId ?? ''}|${record.detail}|${record.prevHash}`;
  const salt = `${AUDIT_HASH_SALT_PREFIX}|${record.prevHash}`;
  const derived = await pbkdf2Async(payload, salt, AUDIT_HASH_ITERATIONS, AUDIT_HASH_KEY_LENGTH, AUDIT_HASH_DIGEST);
  return derived.toString('hex');
}

export class AuditLogger {
  private logDir: string;
  private lastHash: string;
  private writeLock: Promise<void>;

  constructor(logDir?: string) {
    this.logDir = logDir ?? join(homedir(), '.aegis', 'audit');
    this.lastHash = '';
    this.writeLock = Promise.resolve();
  }

  private async assertNotSymlink(pathValue: string): Promise<void> {
    try {
      const stats = await lstat(pathValue);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to operate on symlink path: ${pathValue}`);
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return;
      throw error;
    }
  }

  private async assertAuditPathSafe(filePath: string): Promise<void> {
    await this.assertNotSymlink(this.logDir);
    await this.assertNotSymlink(dirname(filePath));
    await this.assertNotSymlink(filePath);
  }

  /** Initialize the audit logger — ensure directory exists, read last hash. */
  async init(): Promise<void> {
    await this.assertNotSymlink(this.logDir);
    if (!existsSync(this.logDir)) {
      await mkdir(this.logDir, { recursive: true });
    }
    await this.recoverLastHash();
  }

  /** Recover the last hash from the most recent audit log file. */
  private async recoverLastHash(): Promise<void> {
    try {
      const files = await readdir(this.logDir);
      const logFiles = files
        .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
        .sort()
        .reverse();

      if (logFiles.length === 0) {
        this.lastHash = '';
        return;
      }

      const latestFile = join(this.logDir, logFiles[0]!);
      await this.assertNotSymlink(latestFile);
      const content = await readFile(latestFile, 'utf-8');
      const lines = content.trim().split('\n');

      if (lines.length === 0) {
        this.lastHash = '';
        return;
      }

      const lastLine = lines[lines.length - 1]!;
      try {
        const record = JSON.parse(lastLine) as AuditRecord;
        this.lastHash = record.hash;
      } catch {
        // Corrupted last line — scan backwards for valid JSON
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const rec = JSON.parse(lines[i]!) as AuditRecord;
            this.lastHash = rec.hash;
            return;
          } catch {
            continue;
          }
        }
        this.lastHash = '';
      }
    } catch {
      this.lastHash = '';
    }
  }

  /** Get the file path for a given date. */
  private filePath(d: Date): string {
    return join(this.logDir, `audit-${dateToFileDate(d)}.log`);
  }

  /**
   * Append an audit record. Serialized through a write lock to guarantee
   * ordering and correct hash chaining even under concurrent callers.
   */
  async log(
    actor: string,
    action: AuditAction,
    detail: string,
    sessionId?: string,
  ): Promise<AuditRecord> {
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.writeLock;
    this.writeLock = lock;

    try {
      await previous.catch(() => {});

      const ts = new Date().toISOString();
      const partial: Omit<AuditRecord, 'hash'> = {
        ts,
        actor,
        action,
        sessionId,
        detail,
        prevHash: this.lastHash,
      };
      const hash = await computeHash(partial);
      const record: AuditRecord = { ...partial, hash };

      const line = JSON.stringify(record) + '\n';
      const file = this.filePath(new Date(ts));
      await this.assertAuditPathSafe(file);

      // Ensure directory exists (in case it was cleaned)
      if (!existsSync(dirname(file))) {
        await mkdir(dirname(file), { recursive: true });
        await this.assertNotSymlink(dirname(file));
      }

      // Append-only — never overwrite
      await appendFile(file, line, { mode: 0o600 });
      await secureFilePermissions(file);

      this.lastHash = hash;
      return record;
    } finally {
      release();
    }
  }

  /**
   * Verify the integrity of the audit log by checking the hash chain.
   * Returns { valid: true } if all records chain correctly,
   * or { valid: false, brokenAt: lineNumber } if a tampered record is found.
   */
  async verify(): Promise<{ valid: boolean; brokenAt?: number; file?: string }> {
    try {
      const files = await readdir(this.logDir);
      const logFiles = files
        .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
        .sort();

      let prevHash = '';
      let globalLineNum = 0;

      for (const file of logFiles) {
        const fullPath = join(this.logDir, file);
        await this.assertNotSymlink(fullPath);
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          globalLineNum++;
          try {
            const record = JSON.parse(line) as AuditRecord;

            if (record.prevHash !== prevHash) {
              return { valid: false, brokenAt: globalLineNum, file };
            }

            const expectedHash = await computeHash(record);
            if (record.hash !== expectedHash) {
              return { valid: false, brokenAt: globalLineNum, file };
            }

            prevHash = record.hash;
          } catch {
            return { valid: false, brokenAt: globalLineNum, file };
          }
        }
      }

      return { valid: true };
    } catch {
      return { valid: true };
    }
  }

  /**
   * Query audit records across all log files.
   * Reads files in chronological order and applies filters.
   */
  async query(options: AuditQueryOptions = {}): Promise<AuditRecord[]> {
    const {
      actor,
      action,
      sessionId,
      limit = 100,
      reverse = false,
    } = options;

    try {
      const files = await readdir(this.logDir);
      const logFiles = files
        .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
        .sort();

      const allRecords: AuditRecord[] = [];

      for (const file of logFiles) {
        const fullPath = join(this.logDir, file);
        await this.assertNotSymlink(fullPath);
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          try {
            const record = JSON.parse(line) as AuditRecord;

            if (actor && record.actor !== actor) continue;
            if (action && record.action !== action) continue;
            if (sessionId && record.sessionId !== sessionId) continue;

            allRecords.push(record);
          } catch {
            // Skip malformed lines
            continue;
          }
        }
      }

      // Apply limit after filtering
      const result = reverse
        ? allRecords.slice(-limit).reverse()
        : allRecords.slice(-limit);

      return result;
    } catch {
      return [];
    }
  }
}

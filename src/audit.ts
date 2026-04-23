/**
 * audit.ts — Tamper-evident append-only audit trail.
 *
 * Issue #1419: SOC2/ISO 27001 compliance.
 *
 * Each record is chained via SHA-256 hashes — the hash of record N
 * includes the hash of record N-1, making retroactive edits detectable.
 * Log files rotate daily and are never overwritten.
 *
 * Issue #1642: Replaced PBKDF2-120k with SHA-256 to avoid blocking
 * libuv's thread pool under audit-heavy workloads.
 */

import { createHash, createHmac, scryptSync } from 'node:crypto';
import { appendFile, readFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { secureFilePermissions } from './file-utils.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface AuditRecord {
  /** ISO 8601 timestamp */
  ts: string;
  /** Actor label (for example 'key:deploy-bot', 'master', or 'system') */
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
  | 'key.rotate'
  | 'key.quotas.update'
  | 'session.create'
  | 'session.kill'
  | 'session.quota.rejected'
  | 'session.env.rejected'
  | 'session.action.allowed'
  | 'session.action.denied'
  | 'permission.approve'
  | 'permission.reject'
  | 'api.authenticated';

export interface AuditFilterOptions {
  /** Filter by actor label */
  actor?: string;
  /** Filter by action */
  action?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Inclusive lower timestamp bound (ISO 8601) */
  from?: string;
  /** Inclusive upper timestamp bound (ISO 8601) */
  to?: string;
}

export interface AuditQueryOptions extends AuditFilterOptions {
  /** Max records to return (default 100) */
  limit?: number;
  /** Return records from newest first (default false = chronological) */
  reverse?: boolean;
  /** Pagination cursor (record hash of the oldest record in the prior page) */
  cursor?: string;
}

export interface AuditQueryPage {
  records: AuditRecord[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export interface AuditChainMetadata {
  count: number;
  firstHash: string | null;
  lastHash: string | null;
  badgeHash: string | null;
  firstTs: string | null;
  lastTs: string | null;
}

/**
 * Issue #2082: Normalised export record for the audit export API.
 * Fields are renamed from the on-disk AuditRecord to provide a stable,
 * consumer-friendly schema with explicit identifiers and sequence numbers.
 */
export interface AuditExportRecord {
  /** Unique record identifier (the record's chain hash) */
  id: string;
  /** Global 1-based position in the hash chain across all log files */
  sequence: number;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Actor key identifier (e.g. 'key:deploy-bot', 'master', 'system') */
  actorKeyId: string;
  /** Associated session ID, if applicable */
  sessionId: string;
  /** Action category (e.g. 'key.create', 'session.kill') */
  action: string;
  /** Human-readable description of what was affected */
  resource: string;
  /** SHA-256 hash of this record (hex) */
  hash: string;
  /** SHA-256 hash of previous record (hex) */
  prevHash: string;
  /** Additional metadata (sessionId, detail, etc.) */
  metadata: Record<string, unknown>;
}

export interface AuditOffsetPage {
  records: AuditExportRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ── Implementation ─────────────────────────────────────────────────────

export const AUDIT_EXPORT_COLUMNS = [
  'ts',
  'actor',
  'action',
  'sessionId',
  'detail',
  'prevHash',
  'hash',
] as const satisfies ReadonlyArray<keyof AuditRecord>;

export const AUDIT_EXPORT_V2_COLUMNS = [
  'id',
  'sequence',
  'timestamp',
  'actorKeyId',
  'sessionId',
  'action',
  'resource',
  'hash',
  'prevHash',
] as const satisfies ReadonlyArray<string>;

function dateToFileDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Issue #1642: v3 chain uses SHA-256 (fast, non-blocking) instead of PBKDF2.
// New records include the actor in the hash payload. Verification still accepts
// the legacy actor-omitting payload so pre-upgrade logs remain valid.
const AUDIT_CHAIN_DOMAIN = 'aegis-audit-chain-v4';
const AUDIT_ACTOR_DOMAIN = 'aegis-audit-actor-v1';
const actorHashComponentCache = new Map<string, string>();

function computeLegacyHash(record: Omit<AuditRecord, 'hash'>): string {
  const payload = `${record.ts}|${record.action}|${record.sessionId ?? ''}|${record.detail}|${record.prevHash}`;
  return createHash('sha256').update(payload).digest('hex');
}

function computeActorHashComponent(actor: string): string {
  const cached = actorHashComponentCache.get(actor);
  if (cached) return cached;

  // The chain HMAC covers the actor through a derived component so the audit
  // trail remains tamper-evident without feeding raw actor labels into the
  // final digest. Cache per-actor results to keep steady-state write cost low.
  const derived = scryptSync(actor, AUDIT_ACTOR_DOMAIN, 32).toString('hex');
  actorHashComponentCache.set(actor, derived);
  return derived;
}

function computeHash(record: Omit<AuditRecord, 'hash'>): string {
  const payload = `${record.ts}|${computeActorHashComponent(record.actor)}|${record.action}|${record.sessionId ?? ''}|${record.detail}|${record.prevHash}`;
  return createHmac('sha256', AUDIT_CHAIN_DOMAIN).update(payload).digest('hex');
}

function matchesKnownHashFormat(record: AuditRecord): boolean {
  return record.hash === computeHash(record) || record.hash === computeLegacyHash(record);
}

function csvEscape(value: string | undefined): string {
  if (value === undefined) return '';
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseAuditTimestamp(ts: string): number | null {
  const value = Date.parse(ts);
  return Number.isFinite(value) ? value : null;
}

export function auditRecordsToCsv(records: readonly AuditRecord[]): string {
  const header = AUDIT_EXPORT_COLUMNS.join(',');
  const rows = records.map(record => (
    AUDIT_EXPORT_COLUMNS.map(column => csvEscape(record[column] as string | undefined)).join(',')
  ));
  return `${header}\n${rows.join('\n')}\n`;
}

export function auditRecordsToNdjson(records: readonly AuditRecord[]): string {
  if (records.length === 0) return '';
  return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
}

/** Transform an on-disk AuditRecord into the normalised AuditExportRecord shape (#2082). */
export function toExportRecord(record: AuditRecord, sequence: number): AuditExportRecord {
  return {
    id: record.hash,
    sequence,
    timestamp: record.ts,
    actorKeyId: record.actor,
    sessionId: record.sessionId ?? '',
    action: record.action,
    resource: record.detail,
    hash: record.hash,
    prevHash: record.prevHash,
    metadata: record.sessionId ? { sessionId: record.sessionId } : {},
  };
}

export function auditExportRecordsToCsv(records: readonly AuditExportRecord[]): string {
  const header = AUDIT_EXPORT_V2_COLUMNS.join(',');
  const rows = records.map(record => (
    AUDIT_EXPORT_V2_COLUMNS.map(column => csvEscape(String(record[column as keyof AuditExportRecord] ?? ''))).join(',')
  ));
  return `${header}\n${rows.join('\n')}\n`;
}

export function buildAuditChainMetadata(records: readonly AuditRecord[]): AuditChainMetadata {
  const first = records[0];
  const last = records[records.length - 1];

  if (!first || !last) {
    return {
      count: 0,
      firstHash: null,
      lastHash: null,
      badgeHash: null,
      firstTs: null,
      lastTs: null,
    };
  }

  return {
    count: records.length,
    firstHash: first.hash,
    lastHash: last.hash,
    badgeHash: createHash('sha256').update(`${first.hash}:${last.hash}`).digest('hex'),
    firstTs: first.ts,
    lastTs: last.ts,
  };
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

  /**
   * Flush pending audit writes — awaits the current write lock.
   * Safe to call during graceful shutdown to ensure all in-flight log() calls complete.
   */
  async flush(): Promise<void> {
    await this.writeLock.catch(() => {});
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
      const hash = computeHash(partial);
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

            if (!matchesKnownHashFormat(record)) {
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
      return { valid: false, file: this.logDir };
    }
  }

  /**
   * Read all matching audit records in chronological order.
   */
  private async readMatchingRecords(options: AuditFilterOptions = {}): Promise<AuditRecord[]> {
    const {
      actor,
      action,
      sessionId,
      from,
      to,
    } = options;
    const fromMs = from ? parseAuditTimestamp(from) : null;
    const toMs = to ? parseAuditTimestamp(to) : null;

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
            const recordTs = parseAuditTimestamp(record.ts);
            if (recordTs === null) continue;

            if (actor && record.actor !== actor) continue;
            if (action && record.action !== action) continue;
            if (sessionId && record.sessionId !== sessionId) continue;
            if (fromMs !== null && recordTs < fromMs) continue;
            if (toMs !== null && recordTs > toMs) continue;

            allRecords.push(record);
          } catch {
            // Skip malformed lines
            continue;
          }
        }
      }

      return allRecords;
    } catch {
      return [];
    }
  }

  /**
   * Query all matching audit records.
   * Returns chronological order by default or newest-first when reverse=true.
   */
  async queryAll(options: AuditFilterOptions & { reverse?: boolean } = {}): Promise<AuditRecord[]> {
    const records = await this.readMatchingRecords(options);
    return options.reverse ? records.reverse() : records;
  }

  /**
   * Query a cursor-paginated slice of the matching audit records.
   *
   * Pages always advance from newer records to older records. When reverse=false,
   * each page is returned in chronological order to preserve the existing API
   * shape; when reverse=true, records are returned newest-first.
   */
  async queryPage(options: AuditQueryOptions = {}): Promise<AuditQueryPage> {
    const {
      limit = 100,
      reverse = false,
      cursor,
      ...filters
    } = options;

    const newestFirst = (await this.readMatchingRecords(filters)).reverse();
    let startIndex = 0;

    if (cursor) {
      const cursorIndex = newestFirst.findIndex(record => record.hash === cursor);
      if (cursorIndex === -1) {
        throw new Error('Invalid audit cursor');
      }
      startIndex = cursorIndex + 1;
    }

    const pageNewestFirst = newestFirst.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < newestFirst.length;
    const nextCursor = hasMore && pageNewestFirst.length > 0
      ? pageNewestFirst[pageNewestFirst.length - 1]!.hash
      : null;

    return {
      records: reverse ? pageNewestFirst : pageNewestFirst.slice().reverse(),
      total: newestFirst.length,
      hasMore,
      nextCursor,
      limit,
    };
  }

  /**
   * Query the newest matching audit records.
   * Preserves the historical API behaviour of returning the latest window.
   */
  async query(options: AuditQueryOptions = {}): Promise<AuditRecord[]> {
    return (await this.queryPage(options)).records;
  }

  /**
   * Read all audit records from disk with their global 1-based sequence number.
   * Sequence numbers are assigned based on position in the hash chain across all files.
   */
  private async readAllWithSequence(): Promise<Array<AuditRecord & { sequence: number }>> {
    try {
      const files = await readdir(this.logDir);
      const logFiles = files
        .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
        .sort();

      const allRecords: Array<AuditRecord & { sequence: number }> = [];
      let globalSeq = 0;

      for (const file of logFiles) {
        const fullPath = join(this.logDir, file);
        await this.assertNotSymlink(fullPath);
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.trim().split('\n');

        for (const line of lines) {
          try {
            const record = JSON.parse(line) as AuditRecord;
            globalSeq++;
            allRecords.push({ ...record, sequence: globalSeq });
          } catch {
            // Skip malformed lines but still increment sequence
            globalSeq++;
          }
        }
      }

      return allRecords;
    } catch {
      return [];
    }
  }

  /**
   * Issue #2082: Offset-paginated query returning normalised AuditExportRecords.
   *
   * Reads all records from disk, assigns global sequence numbers, applies
   * filters, then slices by offset/limit. Records are returned in chronological
   * order (oldest first).
   */
  async queryWithOffset(options: AuditFilterOptions & {
    limit?: number;
    offset?: number;
  } = {}): Promise<AuditOffsetPage> {
    const {
      limit = 100,
      offset = 0,
      ...filters
    } = options;

    const fromMs = filters.from ? parseAuditTimestamp(filters.from) : null;
    const toMs = filters.to ? parseAuditTimestamp(filters.to) : null;

    const allRecords = await this.readAllWithSequence();

    const filtered = allRecords.filter(record => {
      const recordTs = parseAuditTimestamp(record.ts);
      if (recordTs === null) return false;
      if (filters.actor && record.actor !== filters.actor) return false;
      if (filters.action && record.action !== filters.action) return false;
      if (filters.sessionId && record.sessionId !== filters.sessionId) return false;
      if (fromMs !== null && recordTs < fromMs) return false;
      if (toMs !== null && recordTs > toMs) return false;
      return true;
    });

    const page = filtered.slice(offset, offset + limit);
    const hasMore = offset + limit < filtered.length;

    return {
      records: page.map(r => toExportRecord(r, r.sequence)),
      total: filtered.length,
      limit,
      offset,
      hasMore,
    };
  }
}

/**
 * audit.test.ts — Tests for Issue #1419: Tamper-evident audit log.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  AuditLogger,
  auditRecordsToCsv,
  auditRecordsToNdjson,
  buildAuditChainMetadata,
  type AuditAction,
} from '../audit.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, readdir, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';

describe('AuditLogger (Issue #1419)', () => {
  let audit: AuditLogger;
  let tmpDir: string;

  async function logAt(
    ts: string,
    actor: string,
    action: AuditAction,
    detail: string,
    sessionId?: string,
  ) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ts));
    try {
      return await audit.log(actor, action, detail, sessionId);
    } finally {
      vi.useRealTimers();
    }
  }

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `aegis-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    audit = new AuditLogger(tmpDir);
    await audit.init();
  });

  function computeLegacyHash(record: {
    ts: string;
    action: AuditAction;
    sessionId?: string;
    detail: string;
    prevHash: string;
  }): string {
    return createHash('sha256')
      .update(`${record.ts}|${record.action}|${record.sessionId ?? ''}|${record.detail}|${record.prevHash}`)
      .digest('hex');
  }

  afterEach(async () => {
    vi.useRealTimers();
    try { await rm(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  describe('log()', () => {
    it('should append a record with correct fields', async () => {
      const record = await audit.log('master', 'key.create', 'Test key created');
      expect(record.ts).toBeTruthy();
      expect(record.actor).toBe('master');
      expect(record.action).toBe('key.create');
      expect(record.detail).toBe('Test key created');
      expect(record.prevHash).toBe('');
      expect(record.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should chain hashes between consecutive records', async () => {
      const r1 = await audit.log('key-1', 'session.create', 'Session started', 'sess-1');
      const r2 = await audit.log('key-1', 'session.kill', 'Session killed', 'sess-1');
      expect(r2.prevHash).toBe(r1.hash);
      expect(r2.hash).not.toBe(r1.hash);
    });

    it('should include sessionId when provided', async () => {
      const record = await audit.log('admin', 'session.create', 'Created', 'abc-123');
      expect(record.sessionId).toBe('abc-123');
    });

    it('should omit sessionId when not provided', async () => {
      const record = await audit.log('system', 'key.create', 'Key made');
      expect(record.sessionId).toBeUndefined();
    });

    it('should create a date-stamped log file', async () => {
      await audit.log('system', 'key.create', 'Test');
      const files = await readdir(tmpDir);
      const logFiles = files.filter(f => f.startsWith('audit-') && f.endsWith('.log'));
      expect(logFiles.length).toBe(1);
      expect(logFiles[0]).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.log$/);
    });
  });

  describe('verify()', () => {
    it('should return valid=true for an untampered log', async () => {
      await audit.log('master', 'key.create', 'Key 1');
      await audit.log('master', 'key.create', 'Key 2');
      const result = await audit.verify();
      expect(result.valid).toBe(true);
    });

    it('should detect a tampered record', async () => {
      await audit.log('master', 'key.create', 'Original');
      // Manually tamper with the file
      const files = await readdir(tmpDir);
      const logFile = files.find(f => f.startsWith('audit-'));
      if (!logFile) throw new Error('No log file');
      const content = await readFile(join(tmpDir, logFile), 'utf-8');
      const tampered = content.replace(/"detail":"Original"/, '"detail":"Tampered"');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(tmpDir, logFile), tampered);
      const result = await audit.verify();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBeDefined();
    });

    it('should detect actor tampering in newly written records', async () => {
      await audit.log('master', 'key.create', 'Original');
      const files = await readdir(tmpDir);
      const logFile = files.find(f => f.startsWith('audit-'));
      if (!logFile) throw new Error('No log file');
      const content = await readFile(join(tmpDir, logFile), 'utf-8');
      const tampered = content.replace(/"actor":"master"/, '"actor":"viewer"');
      await writeFile(join(tmpDir, logFile), tampered);

      const result = await audit.verify();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });

    it('should detect actor tampering for key-labeled actors', async () => {
      await audit.log('key:deploy-bot', 'session.create', 'Original');
      const files = await readdir(tmpDir);
      const logFile = files.find(f => f.startsWith('audit-'));
      if (!logFile) throw new Error('No log file');
      const content = await readFile(join(tmpDir, logFile), 'utf-8');
      const tampered = content.replace(/"actor":"key:deploy-bot"/, '"actor":"key:release-bot"');
      await writeFile(join(tmpDir, logFile), tampered);

      const result = await audit.verify();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });

    it('accepts legacy records that omitted actor from the hash payload', async () => {
      const filePath = join(tmpDir, 'audit-2026-04-17.log');
      const legacyRecord = {
        ts: '2026-04-17T10:00:00.000Z',
        actor: 'master',
        action: 'key.create' as const,
        detail: 'Legacy record',
        prevHash: '',
      };
      const hash = computeLegacyHash(legacyRecord);

      await writeFile(filePath, `${JSON.stringify({ ...legacyRecord, hash })}\n`);

      const result = await audit.verify();
      expect(result).toEqual({ valid: true });
    });

    it('returns invalid when audit storage cannot be read', async () => {
      const fileBackedPath = join(tmpDir, 'not-a-directory');
      await writeFile(fileBackedPath, 'blocked');
      const blockedAudit = new AuditLogger(fileBackedPath);

      const result = await blockedAudit.verify();
      expect(result).toEqual({ valid: false, file: fileBackedPath });
    });
  });

  describe('query()', () => {
    it('should return records filtered by actor', async () => {
      await audit.log('admin', 'key.create', 'Admin key');
      await audit.log('viewer', 'session.create', 'Viewer session');
      const results = await audit.query({ actor: 'admin' });
      expect(results).toHaveLength(1);
      expect(results[0]!.actor).toBe('admin');
    });

    it('should return records filtered by action', async () => {
      await audit.log('master', 'key.create', 'Created');
      await audit.log('master', 'key.revoke', 'Revoked');
      const results = await audit.query({ action: 'key.revoke' });
      expect(results).toHaveLength(1);
      expect(results[0]!.action).toBe('key.revoke');
    });

    it('should return records filtered by sessionId', async () => {
      await audit.log('admin', 'session.create', 'S1', 's1');
      await audit.log('admin', 'session.create', 'S2', 's2');
      const results = await audit.query({ sessionId: 's1' });
      expect(results).toHaveLength(1);
    });

    it('should respect the limit parameter', async () => {
      for (let i = 0; i < 10; i++) {
        await audit.log('system', 'api.authenticated', `Call ${i}`);
      }
      const results = await audit.query({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('should return records in reverse order when requested', async () => {
      await audit.log('system', 'key.create', 'First');
      await audit.log('system', 'key.create', 'Second');
      await audit.log('system', 'key.create', 'Third');
      const results = await audit.query({ limit: 2, reverse: true });
      expect(results).toHaveLength(2);
      expect(results[0]!.detail).toBe('Third');
      expect(results[1]!.detail).toBe('Second');
    });

    it('should return empty array for no matching records', async () => {
      const results = await audit.query({ actor: 'nonexistent' });
      expect(results).toHaveLength(0);
    });
  });

  describe('queryPage()', () => {
    it('paginates from newer records to older records via cursor', async () => {
      await logAt('2026-04-17T10:00:00.000Z', 'admin', 'key.create', 'First');
      await logAt('2026-04-17T11:00:00.000Z', 'admin', 'key.revoke', 'Second');
      await logAt('2026-04-17T12:00:00.000Z', 'admin', 'session.create', 'Third', 'sess-1');
      await logAt('2026-04-17T13:00:00.000Z', 'admin', 'session.kill', 'Fourth', 'sess-1');

      const firstPage = await audit.queryPage({ limit: 2 });
      expect(firstPage.records.map(record => record.detail)).toEqual(['Third', 'Fourth']);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextCursor).toBe(firstPage.records[0]!.hash);

      const secondPage = await audit.queryPage({ limit: 2, cursor: firstPage.nextCursor! });
      expect(secondPage.records.map(record => record.detail)).toEqual(['First', 'Second']);
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.nextCursor).toBeNull();
    });

    it('applies inclusive time-range filters before paging', async () => {
      await logAt('2026-04-17T09:59:59.000Z', 'admin', 'key.create', 'Too early');
      await logAt('2026-04-17T10:00:00.000Z', 'admin', 'key.create', 'Start boundary');
      await logAt('2026-04-17T10:30:00.000Z', 'admin', 'session.create', 'Middle', 'sess-2');
      await logAt('2026-04-17T11:00:00.000Z', 'admin', 'session.kill', 'End boundary', 'sess-2');
      await logAt('2026-04-17T11:00:01.000Z', 'admin', 'key.revoke', 'Too late');

      const results = await audit.queryAll({
        from: '2026-04-17T10:00:00.000Z',
        to: '2026-04-17T11:00:00.000Z',
      });

      expect(results.map(record => record.detail)).toEqual([
        'Start boundary',
        'Middle',
        'End boundary',
      ]);
    });
  });

  describe('export helpers', () => {
    it('renders CSV and NDJSON exports with chain metadata', async () => {
      await audit.log('admin', 'key.create', 'Created key');
      await audit.log('admin', 'session.kill', 'Killed "session", safely', 'sess-1');
      const records = await audit.queryAll();

      const csv = auditRecordsToCsv(records);
      expect(csv).toContain('ts,actor,action,sessionId,detail,prevHash,hash');
      expect(csv).toContain('"Killed ""session"", safely"');
      expect(csv.endsWith('\n')).toBe(true);

      const ndjson = auditRecordsToNdjson(records);
      const parsed = ndjson.trim().split('\n').map(line => JSON.parse(line) as { detail: string });
      expect(parsed.map(record => record.detail)).toEqual(['Created key', 'Killed "session", safely']);

      const chain = buildAuditChainMetadata(records);
      expect(chain.count).toBe(2);
      expect(chain.firstHash).toBe(records[0]!.hash);
      expect(chain.lastHash).toBe(records[1]!.hash);
      expect(chain.badgeHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('hash chain integrity', () => {
    it('should recover last hash across restarts', async () => {
      await audit.log('system', 'key.create', 'Before restart');
      const firstHash = (await audit.query({ limit: 1 }))[0]!.hash;

      // Simulate restart — create a new AuditLogger pointing to same dir
      const restarted = new AuditLogger(tmpDir);
      await restarted.init();

      const newRecord = await restarted.log('system', 'key.revoke', 'After restart');
      expect(newRecord.prevHash).toBe(firstHash);
    });

    it('should preserve a valid hash chain under concurrent log writes', async () => {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => audit.log('system', 'api.authenticated', `Call ${i}`)),
      );

      const records = await audit.query({ limit: 8 });
      expect(records).toHaveLength(8);
      expect(records[0]!.prevHash).toBe('');
      for (let i = 1; i < records.length; i++) {
        expect(records[i]!.prevHash).toBe(records[i - 1]!.hash);
      }

      const verification = await audit.verify();
      expect(verification.valid).toBe(true);
    });
  });

  describe('Issue #1618: symlink hardening', () => {
    it('rejects a symlinked audit directory when symlinks are supported', async () => {
      const realDir = join(tmpDir, 'real-audit');
      await mkdir(realDir, { recursive: true });
      const linkedDir = join(tmpDir, 'linked-audit');

      try {
        await symlink(realDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EPERM' || err.code === 'EACCES') return;
        throw error;
      }

      const linkedAudit = new AuditLogger(linkedDir);
      await expect(linkedAudit.init()).rejects.toThrow(/symlink path/);
    });

    it('rejects writes when the target audit log file is a symlink', async () => {
      const date = new Date().toISOString().slice(0, 10);
      const logPath = join(tmpDir, `audit-${date}.log`);
      const targetPath = join(tmpDir, 'outside.log');
      await writeFile(targetPath, '');

      try {
        await symlink(targetPath, logPath, process.platform === 'win32' ? 'file' : undefined);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EPERM' || err.code === 'EACCES') return;
        throw error;
      }

      await expect(audit.log('system', 'key.create', 'Symlink write should fail')).rejects.toThrow(/symlink path/);
    });
  });
});

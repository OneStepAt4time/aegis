/**
 * audit.test.ts — Tests for Issue #1419: Tamper-evident audit log.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../audit.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm, readdir, readFile } from 'node:fs/promises';

describe('AuditLogger (Issue #1419)', () => {
  let audit: AuditLogger;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `aegis-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    audit = new AuditLogger(tmpDir);
    await audit.init();
  });

  afterEach(async () => {
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
  });
});

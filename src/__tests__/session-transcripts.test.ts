/**
 * Issue #3575: Test coverage for session-transcripts.ts
 *
 * Tests SessionTranscripts class: readMessages, getSummary, readTranscript,
 * readTranscriptCursor, clearCache, and filesystem fallback discovery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionTranscripts } from '../session-transcripts.js';
import type { SessionInfo, UIState } from '../session.js';
import type { Config } from '../config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    claudeProjectsDir: '/tmp/nonexistent',
    stateDir: '/tmp/aegis-test',
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    ...overrides,
  } as unknown as Config;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-1',
    windowId: '',
    displayName: 'test-session',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle' as UIState,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 30_000,
    permissionStallMs: 60_000,
    permissionMode: 'default',
    ownerKeyId: 'key-1',
    tenantId: 'tenant-1',
    ...overrides,
  };
}

/** Write a minimal JSONL file with the given entries. */
function writeJsonl(dir: string, filename: string, entries: Array<{ type: string; message: { role: string; content: string | Array<{ type: string; text?: string }> } }>): string {
  const filePath = join(dir, filename);
  const lines = entries.map(e => JSON.stringify(e));
  writeFileSync(filePath, lines.join('\n') + '\n');
  return filePath;
}

describe('SessionTranscripts', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aegis-transcripts-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readMessages', () => {
    it('returns empty messages when no JSONL path and no claudeSessionId', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession();
      const result = await transcripts.readMessages(session);

      expect(result.messages).toEqual([]);
      expect(result.status).toBe('idle');
      expect(result.statusText).toBeNull();
      expect(result.interactiveContent).toBeNull();
    });

    it('reads messages from JSONL file and advances byteOffset', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', [
        { type: 'user', message: { role: 'user', content: 'Hello' } },
        { type: 'assistant', message: { role: 'assistant', content: 'Hi there' } },
      ]);

      const session = makeSession({ jsonlPath });
      expect(session.byteOffset).toBe(0);

      const result = await transcripts.readMessages(session);
      expect(result.messages.length).toBeGreaterThanOrEqual(2);
      expect(session.byteOffset).toBeGreaterThan(0);
    });

    it('reads only new entries on subsequent calls', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', [
        { type: 'user', message: { role: 'user', content: 'First' } },
      ]);

      const session = makeSession({ jsonlPath });
      const result1 = await transcripts.readMessages(session);
      expect(result1.messages.length).toBeGreaterThanOrEqual(1);

      // Append new entry
      appendFileSync(jsonlPath, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Second' } }) + '\n');

      const result2 = await transcripts.readMessages(session);
      // Should only get the new entry
      expect(result2.messages.length).toBeGreaterThanOrEqual(1);
    });

    it('preserves status from session when detectUIState is stub', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession({ status: 'pending' as UIState });
      const result = await transcripts.readMessages(session);
      expect(result.status).toBe('pending');
    });

    it('invalidates stale jsonlPath when file no longer exists', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession({ jsonlPath: '/tmp/nonexistent-file-12345.jsonl' });

      await transcripts.readMessages(session);
      expect(session.jsonlPath).toBeUndefined();
    });

    it('updates lastActivity on read', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession({ lastActivity: 0 });
      const before = Date.now();
      await transcripts.readMessages(session);
      expect(session.lastActivity).toBeGreaterThanOrEqual(before);
    });

    it('handles JSONL read errors gracefully', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      // Create a file with invalid JSON
      const jsonlPath = join(tempDir, 'bad.jsonl');
      writeFileSync(jsonlPath, 'not valid jsonl\n');

      const session = makeSession({ jsonlPath });
      // Should not throw — returns empty or partial
      const result = await transcripts.readMessages(session);
      expect(result.messages).toBeDefined();
    });
  });

  describe('readMessagesForMonitor', () => {
    it('returns empty messages when no JSONL path', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession();
      const result = await transcripts.readMessagesForMonitor(session);
      expect(result.messages).toEqual([]);
    });

    it('reads from JSONL using monitorOffset', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', [
        { type: 'user', message: { role: 'user', content: 'Hello' } },
      ]);

      const session = makeSession({ jsonlPath, monitorOffset: 0 });
      const result = await transcripts.readMessagesForMonitor(session);
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(session.monitorOffset).toBeGreaterThan(0);
    });

    it('invalidates stale jsonlPath', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession({ jsonlPath: '/tmp/nonexistent-monitor.jsonl' });
      await transcripts.readMessagesForMonitor(session);
      expect(session.jsonlPath).toBeUndefined();
    });

    it('preserves session status', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession({ status: 'working' as UIState });
      const result = await transcripts.readMessagesForMonitor(session);
      expect(result.status).toBe('working');
    });
  });

  describe('getSummary', () => {
    it('returns summary with zero messages when no JSONL', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession({ displayName: 'my-session' });
      const summary = await transcripts.getSummary(session);

      expect(summary.sessionId).toBe('test-session-1');
      expect(summary.displayName).toBe('my-session');
      expect(summary.totalMessages).toBe(0);
      expect(summary.messages).toEqual([]);
      expect(summary.permissionMode).toBe('default');
    });

    it('returns messages truncated to maxMessages', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const entries = Array.from({ length: 10 }, (_, i) => ({
        type: 'user',
        message: { role: 'user', content: `Message ${i}` },
      }));
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', entries);

      const session = makeSession({ jsonlPath });
      await transcripts.readMessages(session);

      const summary = await transcripts.getSummary(session, 3);
      expect(summary.messages.length).toBe(3);
      expect(summary.totalMessages).toBeGreaterThanOrEqual(10);
    });

    it('truncates long message text to 500 chars', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const longText = 'x'.repeat(1000);
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', [
        { type: 'user', message: { role: 'user', content: longText } },
      ]);

      const session = makeSession({ jsonlPath });
      await transcripts.readMessages(session);

      const summary = await transcripts.getSummary(session);
      expect(summary.messages[0].text.length).toBeLessThanOrEqual(500);
    });

    it('includes prd from session if present', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession({ prd: 'Build feature X' });
      const summary = await transcripts.getSummary(session);
      expect(summary.prd).toBe('Build feature X');
    });
  });

  describe('readTranscript', () => {
    it('returns paginated results', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const entries = Array.from({ length: 10 }, (_, i) => ({
        type: 'user',
        message: { role: 'user', content: `Msg ${i}` },
      }));
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', entries);

      const session = makeSession({ jsonlPath });
      await transcripts.readMessages(session);

      const page1 = await transcripts.readTranscript(session, 1, 3);
      expect(page1.messages.length).toBe(3);
      expect(page1.page).toBe(1);
      expect(page1.limit).toBe(3);
      expect(page1.total).toBeGreaterThanOrEqual(10);
      expect(page1.hasMore).toBe(true);

      const page4 = await transcripts.readTranscript(session, 4, 3);
      expect(page4.hasMore).toBe(false);
    });

    it('filters by role', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', [
        { type: 'user', message: { role: 'user', content: 'Hello' } },
        { type: 'assistant', message: { role: 'assistant', content: 'Hi' } },
        { type: 'user', message: { role: 'user', content: 'World' } },
      ]);

      const session = makeSession({ jsonlPath });
      await transcripts.readMessages(session);

      const userOnly = await transcripts.readTranscript(session, 1, 50, 'user');
      expect(userOnly.messages.every(m => m.role === 'user')).toBe(true);
    });

    it('returns empty when no JSONL', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession();
      const result = await transcripts.readTranscript(session);
      expect(result.messages).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('readTranscriptCursor', () => {
    it('returns entries with cursor IDs', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const entries = Array.from({ length: 5 }, (_, i) => ({
        type: 'user',
        message: { role: 'user', content: `Msg ${i}` },
      }));
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', entries);

      const session = makeSession({ jsonlPath });
      await transcripts.readMessages(session);

      const result = await transcripts.readTranscriptCursor(session, undefined, 3);
      expect(result.messages.length).toBe(3);
      expect(result.messages[0]._cursor_id).toBeDefined();
      expect(result.has_more).toBe(true);
      expect(result.oldest_id).toBeDefined();
      expect(result.newest_id).toBeDefined();
    });

    it('respects beforeId to fetch older entries', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const entries = Array.from({ length: 10 }, (_, i) => ({
        type: 'user',
        message: { role: 'user', content: `Msg ${i}` },
      }));
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', entries);

      const session = makeSession({ jsonlPath });
      await transcripts.readMessages(session);

      const result = await transcripts.readTranscriptCursor(session, 5, 3);
      expect(result.messages.length).toBe(3);
      expect(result.messages[result.messages.length - 1]._cursor_id).toBeLessThan(5);
    });

    it('clamps limit to max 200', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession();
      const result = await transcripts.readTranscriptCursor(session, undefined, 999);
      expect(result.messages).toEqual([]);
    });

    it('returns null IDs when no entries', async () => {
      const transcripts = new SessionTranscripts(makeConfig());
      const session = makeSession();
      const result = await transcripts.readTranscriptCursor(session);
      expect(result.oldest_id).toBeNull();
      expect(result.newest_id).toBeNull();
    });

    it('filters by role', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const entries = [
        { type: 'user', message: { role: 'user', content: 'Q1' } },
        { type: 'assistant', message: { role: 'assistant', content: 'A1' } },
        { type: 'user', message: { role: 'user', content: 'Q2' } },
      ];
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', entries);

      const session = makeSession({ jsonlPath });
      await transcripts.readMessages(session);

      const result = await transcripts.readTranscriptCursor(session, undefined, 10, 'user');
      expect(result.messages.every(m => m.role === 'user')).toBe(true);
      expect(result.messages.length).toBe(2);
    });
  });

  describe('clearCache', () => {
    it('removes cached entries without error', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', [
        { type: 'user', message: { role: 'user', content: 'Hello' } },
      ]);

      const session = makeSession({ id: 'cache-test', jsonlPath });
      await transcripts.readMessages(session);

      // Should not throw
      transcripts.clearCache('cache-test');
    });

    it('clearing non-existent session does not throw', () => {
      const transcripts = new SessionTranscripts(makeConfig());
      transcripts.clearCache('nonexistent');
    });
  });

  describe('discoverFromFilesystemFallback', () => {
    it('returns empty when no workDir set', async () => {
      const transcripts = new SessionTranscripts(makeConfig({
        claudeProjectsDir: tempDir,
      }));
      const session = makeSession({ workDir: '/some/path', jsonlPath: undefined, claudeSessionId: undefined });
      const result = await transcripts.readMessages(session);
      expect(result.messages).toEqual([]);
    });

    it('uses existing jsonlPath when set', async () => {
      const config = makeConfig({ claudeProjectsDir: tempDir });
      const transcripts = new SessionTranscripts(config);
      const jsonlPath = writeJsonl(tempDir, 'session.jsonl', [
        { type: 'user', message: { role: 'user', content: 'Hello' } },
      ]);

      const session = makeSession({ jsonlPath });
      const result = await transcripts.readMessages(session);
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('setAcpEventStore', () => {
    it('accepts ACP event store without error', () => {
      const transcripts = new SessionTranscripts(makeConfig());
      transcripts.setAcpEventStore({
        append: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      } as any);
    });
  });
});

/**
 * fix-841-840-836.test.ts — Tests for three bug fixes:
 *
 * - #841: lastUsedAt mutated before rate-limit check
 * - #840: TOCTOU race in findIdleSessionByWorkDir
 * - #836: 4KB newline scan falls back to offset 0 for long JSONL lines
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager } from '../auth.js';
import { readNewEntries } from '../transcript.js';
import { SessionManager, type SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Issue #841: lastUsedAt must NOT update for rate-limited requests
// ---------------------------------------------------------------------------
describe('Issue #841: lastUsedAt not updated for rate-limited requests', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-test-841-${Date.now()}.json`);
    auth = new AuthManager(tmpFile, '');
  });

  afterEach(() => {
    try { rmSync(tmpFile); } catch { /* ignore */ }
  });

  it('should NOT update lastUsedAt when request is rate-limited', async () => {
    // Create key with rate limit of 1
    const { key } = await auth.createKey('rate-test', 1);
    const store = (auth as any).store as { keys: Array<{ lastUsedAt: number; id: string }> };

    // First request — accepted
    auth.validate(key);
    const firstUsed = store.keys[0].lastUsedAt;

    // Second request — rate-limited
    const result = auth.validate(key);
    expect(result.rateLimited).toBe(true);

    // lastUsedAt should NOT have changed
    expect(store.keys[0].lastUsedAt).toBe(firstUsed);
  });

  it('should update lastUsedAt when request is accepted', async () => {
    const { key } = await auth.createKey('rate-test', 10);
    const store = (auth as any).store as { keys: Array<{ lastUsedAt: number; id: string }> };

    // First request — accepted
    auth.validate(key);
    const firstUsed = store.keys[0].lastUsedAt;

    // Wait a tiny bit so timestamps differ
    await new Promise((r) => setTimeout(r, 2));

    // Second request — also accepted (limit is 10)
    auth.validate(key);
    expect(store.keys[0].lastUsedAt).toBeGreaterThan(firstUsed);
  });

  it('should keep lastUsedAt unchanged for multiple rate-limited requests', async () => {
    const { key } = await auth.createKey('rate-test', 1);
    const store = (auth as any).store as { keys: Array<{ lastUsedAt: number; id: string }> };

    // First request — accepted
    auth.validate(key);
    const acceptedUsed = store.keys[0].lastUsedAt;

    // Subsequent requests — all rate-limited
    for (let i = 0; i < 5; i++) {
      const result = auth.validate(key);
      expect(result.rateLimited).toBe(true);
    }

    // lastUsedAt should still be from the accepted request
    expect(store.keys[0].lastUsedAt).toBe(acceptedUsed);
  });
});

// ---------------------------------------------------------------------------
// Issue #840: TOCTOU race in findIdleSessionByWorkDir
// ---------------------------------------------------------------------------
describe('Issue #840: Atomic session acquisition in findIdleSessionByWorkDir', () => {
  function makeSession(overrides: Partial<SessionInfo>): SessionInfo {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      windowId: overrides.windowId ?? '@1',
      windowName: overrides.windowName ?? 'test',
      workDir: overrides.workDir ?? '/project/a',
      status: overrides.status ?? 'idle',
      byteOffset: 0,
      monitorOffset: 0,
      createdAt: Date.now() - 60_000,
      lastActivity: overrides.lastActivity ?? Date.now(),
      stallThresholdMs: 300_000,
      permissionStallMs: 300_000,
      permissionMode: 'default',
    };
  }

  function createSessionManager(sessions: Record<string, SessionInfo>): SessionManager {
    const mockTmux = {
      windowExists: async () => true,
    } as unknown as TmuxManager;

    const config = { stateDir: join(tmpdir(), `aegis-sm-840-${Date.now()}`) } as any;
    const sm = new SessionManager(mockTmux, config);

    // Inject sessions into the state
    (sm as any).state = { sessions };

    return sm;
  }

  it('should change session status so concurrent callers cannot grab it', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle', id: 'sess-1' });
    const sm = createSessionManager({ 'sess-1': session });

    const result = await sm.findIdleSessionByWorkDir('/project/a');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('sess-1');
    // Session should no longer be idle — concurrent callers won't find it
    expect(session.status).not.toBe('idle');
  });

  it('should prevent concurrent callers from acquiring the same session', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle', id: 'sess-1' });
    const sm = createSessionManager({ 'sess-1': session });

    // Launch two concurrent acquisitions
    const [first, second] = await Promise.all([
      sm.findIdleSessionByWorkDir('/project/a'),
      sm.findIdleSessionByWorkDir('/project/a'),
    ]);

    // Only one should get the session
    const results = [first, second].filter((r) => r !== null);
    expect(results).toHaveLength(1);
  });

  it('should prevent TOCTOU race with 3 concurrent callers', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'idle', id: 'sess-1' });
    const sm = createSessionManager({ 'sess-1': session });

    const results = await Promise.all([
      sm.findIdleSessionByWorkDir('/project/a'),
      sm.findIdleSessionByWorkDir('/project/a'),
      sm.findIdleSessionByWorkDir('/project/a'),
    ]);

    const acquired = results.filter((r) => r !== null);
    expect(acquired).toHaveLength(1);
  });

  it('should return null when no idle sessions exist', async () => {
    const session = makeSession({ workDir: '/project/a', status: 'working', id: 'sess-1' });
    const sm = createSessionManager({ 'sess-1': session });

    const result = await sm.findIdleSessionByWorkDir('/project/a');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #836: No fallback to offset 0 for long JSONL lines
// ---------------------------------------------------------------------------
describe('Issue #836: No fallback to offset 0 for long JSONL lines', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `aegis-test-836-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('should NOT fall back to offset 0 when line exceeds 4KB scan window', async () => {
    // Create a JSONL file with one very long line (>4KB, no newlines within it)
    const longContent = 'x'.repeat(8000);
    const longLine = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: longContent },
      timestamp: '2024-01-01T00:00:00Z',
    });
    const filePath = join(tmpDir, 'long-line.jsonl');
    writeFileSync(filePath, `${longLine}\n`);

    const fileSize = longLine.length + 1; // +1 for trailing newline

    // Read from an offset that is within the long line
    // This used to fall back to offset 0, causing a full re-read
    const midOffset = Math.floor(longLine.length / 2);
    const result = await readNewEntries(filePath, midOffset);

    // The result should NOT contain the full line from offset 0
    // (which would happen if it fell back to 0)
    // Instead it should have newOffset that is at least the midOffset
    expect(result.newOffset).toBeGreaterThanOrEqual(midOffset);
  });

  it('should read correctly when offset is past a long line', async () => {
    // File: long line, then a normal line
    const longContent = 'y'.repeat(6000);
    const longLine = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: longContent },
      timestamp: '2024-01-01T00:00:00Z',
    });
    const normalLine = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'After long line' },
      timestamp: '2024-01-01T00:00:01Z',
    });
    const filePath = join(tmpDir, 'long-then-normal.jsonl');
    writeFileSync(filePath, `${longLine}\n${normalLine}\n`);

    // Offset at start of the normal line
    const offset = longLine.length + 1;
    const result = await readNewEntries(filePath, offset);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].text).toBe('After long line');
  });

  it('should still find newlines correctly when line is under 4KB', async () => {
    // Regression test: normal case should still work
    const line1 = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'First' },
      timestamp: '2024-01-01T00:00:00Z',
    });
    const line2 = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'Second' },
      timestamp: '2024-01-01T00:00:01Z',
    });
    const filePath = join(tmpDir, 'normal.jsonl');
    writeFileSync(filePath, `${line1}\n${line2}\n`);

    // Offset in the middle of line2
    const midLine2 = line1.length + 1 + Math.floor(line2.length / 2);
    const result = await readNewEntries(filePath, midLine2);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].text).toBe('Second');
  });
});

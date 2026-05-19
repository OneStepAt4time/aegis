/**
 * Issue #3713 — session.ts state persistence error branches
 *
 * Covers:
 * 1. Corrupted state file (invalid JSON) → fallback to empty state
 * 2. State file fails validation → fallback to empty state
 * 3. Backup state file restores when primary is invalid
 * 4. Backup state file also corrupted → start empty
 * 5. Save queue error → console.error logged
 * 6. Debounced save failure → logged but not thrown
 * 7. doSave() with store backend failure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '../session.js';
import { getConfig } from '../config.js';

const validSession = {
  id: 'sess-1', windowId: 'win-1', displayName: 'test-session',
  workDir: '/tmp/test', byteOffset: 0, monitorOffset: 0,
  status: 'idle', createdAt: Date.now(), lastActivity: Date.now(),
  stallThresholdMs: 300_000, permissionMode: 'default' as const,
};

function createSM(stateDir: string, store?: any): SessionManager {
  return new SessionManager(
    { ...getConfig(), stateDir, authToken: 'test-token' },
    store,
  );
}

describe('Issue #3713 — session.ts state persistence error branches', () => {
  let tmpDir: string;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-state-test-'));
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load() — corrupted/invalid state files', () => {
    it('falls back to empty state when state file has invalid JSON', async () => {
      const stateFile = join(tmpDir, 'state.json');
      writeFileSync(stateFile, '{ not valid json }}}');

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });

    it('falls back to empty state when state file has valid JSON but invalid schema', async () => {
      const stateFile = join(tmpDir, 'state.json');
      writeFileSync(stateFile, JSON.stringify({ sessions: 'not-an-object' }));

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });

    it('falls back to empty state when sessions contain invalid entries', async () => {
      const stateFile = join(tmpDir, 'state.json');
      writeFileSync(stateFile, JSON.stringify({
        sessions: {
          'sess-1': { id: 123, displayName: true },  // invalid types
        },
      }));

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });

    it('falls back to empty state when state file is empty', async () => {
      const stateFile = join(tmpDir, 'state.json');
      writeFileSync(stateFile, '');

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });
  });

  describe('load() — backup recovery', () => {
    it('restores from backup when primary state fails validation', async () => {
      const stateFile = join(tmpDir, 'state.json');
      const backupFile = `${stateFile}.bak`;

      // Write invalid primary state
      writeFileSync(stateFile, JSON.stringify('invalid'));

      // Write valid backup
      writeFileSync(backupFile, JSON.stringify({
        'sess-1': { ...validSession, id: 'sess-1', displayName: 'backup-session' },
      }));

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(1);
      expect(sessions['sess-1'].displayName).toBe('backup-session');
      expect(consoleLogSpy).toHaveBeenCalledWith('Restored state from backup');
    });

    it('starts empty when both primary and backup are corrupted', async () => {
      const stateFile = join(tmpDir, 'state.json');
      const backupFile = `${stateFile}.bak`;

      writeFileSync(stateFile, 'corrupted{{{');
      writeFileSync(backupFile, 'also-corrupted{{{');

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });

    it('starts empty when primary is invalid and no backup exists', async () => {
      const stateFile = join(tmpDir, 'state.json');
      writeFileSync(stateFile, JSON.stringify('invalid'));
      // No backup file

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });

    it('starts empty when backup fails validation too', async () => {
      const stateFile = join(tmpDir, 'state.json');
      const backupFile = `${stateFile}.bak`;

      writeFileSync(stateFile, JSON.stringify('invalid'));
      writeFileSync(backupFile, JSON.stringify('also-invalid'));

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });
  });

  describe('load() — valid state', () => {
    it('loads valid state file successfully', async () => {
      const stateFile = join(tmpDir, 'state.json');
      writeFileSync(stateFile, JSON.stringify({
        'sess-1': { ...validSession, id: 'sess-1', displayName: 'test-session' },
      }));

      const sm = createSM(tmpDir);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(1);
      expect(sessions['sess-1'].displayName).toBe('test-session');
    });

    it('creates backup after successful load', async () => {
      const stateFile = join(tmpDir, 'state.json');
      const backupFile = `${stateFile}.bak`;
      writeFileSync(stateFile, JSON.stringify({
        'sess-1': { ...validSession, id: 'sess-1', displayName: 'test-session' },
      }));

      const sm = createSM(tmpDir);
      await sm.load();

      expect(existsSync(backupFile)).toBe(true);
      const backup = JSON.parse(readFileSync(backupFile, 'utf-8'));
      expect(backup.sessions['sess-1'].id).toBe('sess-1');
    });
  });

  describe('load() — pluggable store backend', () => {
    it('loads from store when store is provided', async () => {
      const store = {
        load: vi.fn(async () => ({
          sessions: {
            'store-sess': { ...validSession, id: 'store-sess', displayName: 'store-session' },
          },
        })),
        save: vi.fn(async () => {}),
      };

      const sm = createSM(tmpDir, store);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(store.load).toHaveBeenCalledOnce();
      expect(sessions['store-sess'].displayName).toBe('store-session');
    });

    it('falls back to empty state when store returns invalid data', async () => {
      const store = {
        load: vi.fn(async () => ({ sessions: 'invalid' })),
        save: vi.fn(async () => {}),
      };

      const sm = createSM(tmpDir, store);
      await sm.load();

      const sessions = (sm as any).state.sessions;
      expect(Object.keys(sessions)).toHaveLength(0);
    });
  });

  describe('save() — error handling', () => {
    it('logs error when doSave fails', async () => {
      const store = {
        load: vi.fn(async () => ({ sessions: {} })),
        save: vi.fn(async () => { throw new Error('store unavailable'); }),
      };

      const sm = createSM(tmpDir, store);
      await sm.load();
      await sm.save();

      expect(consoleErrorSpy).toHaveBeenCalledWith('State save error:', expect.any(Error));
    });
  });

  describe('debouncedSave() — error handling', () => {
    it('logs error when debounced save fails', async () => {
      vi.useFakeTimers();

      const store = {
        load: vi.fn(async () => ({ sessions: {} })),
        save: vi.fn(async () => { throw new Error('debounced save failed'); }),
      };

      const sm = createSM(tmpDir, store);
      await sm.load();
      (sm as any).debouncedSave();

      // Fast-forward past the debounce timer
      await vi.advanceTimersByTimeAsync(10_000);

      // save() catches internally and logs 'State save error:' — the debounced catch never fires
      expect(consoleErrorSpy).toHaveBeenCalledWith('State save error:', expect.anything());

      vi.useRealTimers();
    });
  });
});

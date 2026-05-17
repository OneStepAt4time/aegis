/**
 * Issue #3575: Test coverage for session-discovery.ts
 *
 * Tests SessionDiscovery class: polling lifecycle, session_map sync,
 * cleanSessionMapForWindow, and purgeStaleSessionMapEntries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionDiscovery, type DiscoveryDeps } from '../session-discovery.js';
import type { SessionInfo, UIState } from '../session.js';
import type { Config } from '../config.js';

const NOW = Date.now();

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    claudeProjectsDir: '/tmp/nonexistent',
    stateDir: '/tmp/aegis-test',
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    continuationPointerTtlMs: 86_400_000,
    ...overrides,
  } as unknown as Config;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-1',
    windowId: '@5',
    displayName: 'aegis-abc12345',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle' as UIState,
    createdAt: NOW - 1000,
    lastActivity: NOW,
    stallThresholdMs: 30_000,
    permissionStallMs: 60_000,
    permissionMode: 'default',
    ownerKeyId: 'key-1',
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function makeDeps(sessions: Record<string, SessionInfo> = {}): DiscoveryDeps {
  return {
    getSession: vi.fn((id: string) => sessions[id] ?? null),
    getAllSessions: vi.fn(() => Object.values(sessions)),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

/** Write a valid session_map.json with proper schema fields. */
function writeSessionMap(filePath: string, entries: Record<string, Record<string, unknown>>): void {
  const withDefaults: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(entries)) {
    withDefaults[key] = {
      session_id: 'cc-session-id',
      cwd: '/tmp/test',
      window_name: 'default',
      written_at: NOW,
      ...val,
    };
  }
  writeFileSync(filePath, JSON.stringify(withDefaults, null, 2));
}

async function readSessionMap(filePath: string): Promise<Record<string, unknown>> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(filePath, 'utf-8'));
}

describe('SessionDiscovery', () => {
  let tempDir: string;
  let sessionMapFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'aegis-discovery-test-'));
    sessionMapFile = join(tempDir, 'session_map.json');
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('stopDiscoveryPolling', () => {
    it('stops cleanly when no poller exists', () => {
      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);
      discovery.stopDiscoveryPolling('nonexistent-id');
    });

    it('stops active poller', () => {
      const session = makeSession();
      const deps = makeDeps({ [session.id]: session });
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);

      discovery.startDiscoveryPolling(session.id, session.workDir);
      discovery.stopDiscoveryPolling(session.id);

      vi.advanceTimersByTime(10_000);
    });
  });

  describe('cleanSessionMapForWindow', () => {
    it('removes entries matching displayName', async () => {
      writeSessionMap(sessionMapFile, {
        'aegis-abc12345:@5': {
          window_name: 'aegis-abc12345',
          session_id: 'cc-session-1',
        },
        'other-session:@6': {
          window_name: 'other-session',
          session_id: 'cc-session-2',
        },
      });

      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);
      await discovery.cleanSessionMapForWindow('aegis-abc12345');

      const remaining = await readSessionMap(sessionMapFile);
      expect(Object.keys(remaining)).toHaveLength(1);
      expect(remaining['other-session:@6']).toBeDefined();
    });

    it('removes entries matching windowId suffix', async () => {
      writeSessionMap(sessionMapFile, {
        'aegis-abc12345:@5': {
          window_name: 'aegis-abc12345',
          session_id: 'cc-session-1',
        },
      });

      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);
      await discovery.cleanSessionMapForWindow('aegis-abc12345', '@5');

      const remaining = await readSessionMap(sessionMapFile);
      expect(Object.keys(remaining)).toHaveLength(0);
    });

    it('does nothing when session_map.json does not exist', async () => {
      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), join(tempDir, 'nonexistent.json'));
      await discovery.cleanSessionMapForWindow('any-window');
    });
  });

  describe('purgeStaleSessionMapEntries', () => {
    it('removes entries not matching active windows', async () => {
      writeSessionMap(sessionMapFile, {
        'aegis-abc:@5': {
          window_name: 'aegis-abc',
          session_id: 'cc-1',
        },
        'stale-session:@99': {
          window_name: 'stale-session',
          session_id: 'cc-2',
        },
      });

      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);
      await discovery.purgeStaleSessionMapEntries(
        new Set(['@5']),
        new Set(['aegis-abc']),
      );

      const remaining = await readSessionMap(sessionMapFile);
      expect(Object.keys(remaining)).toHaveLength(1);
      expect(remaining['aegis-abc:@5']).toBeDefined();
    });

    it('keeps entries matching by windowId', async () => {
      writeSessionMap(sessionMapFile, {
        'session:@10': {
          window_name: 'session',
          session_id: 'cc-1',
        },
      });

      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);
      await discovery.purgeStaleSessionMapEntries(
        new Set(['@10']),
        new Set(),
      );

      const remaining = await readSessionMap(sessionMapFile);
      expect(Object.keys(remaining)).toHaveLength(1);
    });

    it('removes all entries when no active windows match', async () => {
      writeSessionMap(sessionMapFile, {
        'old-session:@1': {
          window_name: 'old-session',
          session_id: 'cc-old',
        },
      });

      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);
      await discovery.purgeStaleSessionMapEntries(new Set(), new Set());

      const remaining = await readSessionMap(sessionMapFile);
      expect(Object.keys(remaining)).toHaveLength(0);
    });

    it('does nothing when session_map.json does not exist', async () => {
      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), join(tempDir, 'nope.json'));
      await discovery.purgeStaleSessionMapEntries(new Set(), new Set());
    });
  });

  describe('startDiscoveryPolling', () => {
    it('times out after 5 minutes without error', async () => {
      const session = makeSession({
        claudeSessionId: undefined,
        jsonlPath: undefined,
      });

      const deps = makeDeps({ [session.id]: session });
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);

      discovery.startDiscoveryPolling(session.id, session.workDir);
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    });

    it('stops polling when session is null', async () => {
      const deps = makeDeps();
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);

      discovery.startDiscoveryPolling('nonexistent', '/tmp');
      await vi.advanceTimersByTimeAsync(3_000);

      expect(deps.getSession).toHaveBeenCalledWith('nonexistent');
    });

    it('replaces existing poller when called twice', () => {
      const session = makeSession();
      const deps = makeDeps({ [session.id]: session });
      const discovery = new SessionDiscovery(deps, makeConfig(), sessionMapFile);

      discovery.startDiscoveryPolling(session.id, session.workDir);
      discovery.startDiscoveryPolling(session.id, session.workDir);

      // Should not throw — second call replaces the first
      discovery.stopDiscoveryPolling(session.id);
    });
  });
});

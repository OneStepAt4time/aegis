/**
 * Issue #3716 — session-discovery.ts SessionDiscovery error and edge cases
 *
 * Covers:
 * 1. stopDiscoveryPolling with no active timer (no-op)
 * 2. startDiscoveryPolling stops when session is null
 * 3. startDiscoveryPolling stops when session already has claudeSessionId + jsonlPath
 * 4. cleanSessionMapForWindow with missing map file (no-op)
 * 5. cleanSessionMapForWindow cleans entries by windowName and windowId
 * 6. purgeStaleSessionMapEntries removes entries not matching active sessions
 * 7. purgeStaleSessionMapEntries with missing map file (no-op)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionDiscovery, type DiscoveryDeps } from '../session-discovery.js';
import type { SessionInfo } from '../session.js';

function createMockDeps(sessions: Record<string, SessionInfo> = {}): DiscoveryDeps {
  return {
    getSession: vi.fn((id: string) => sessions[id] ?? null),
    getAllSessions: vi.fn(() => Object.values(sessions)),
    save: vi.fn(async () => {}),
  };
}

const validMapEntry = (overrides: Record<string, any> = {}) => ({
  session_id: 'cc-test-session',
  cwd: '/tmp',
  window_name: 'test',
  written_at: Date.now(),
  ...overrides,
});

function createConfig() {
  return {
    stateDir: '/tmp/test-state',
    claudeProjectsDir: '/tmp/test-projects',
    continuationPointerTtlMs: 86_400_000,
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [] as string[],
  };
}

describe('Issue #3716 — SessionDiscovery error and edge cases', () => {
  let tmpDir: string;
  let consoleLogSpy: any;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-disc-test-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('stopDiscoveryPolling', () => {
    it('is a no-op when no timer exists', () => {
      const deps = createMockDeps();
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, join(tmpDir, 'map.json'));

      // Should not throw
      expect(() => discovery.stopDiscoveryPolling('nonexistent')).not.toThrow();
    });

    it('clears an active polling timer', () => {
      const session: SessionInfo = {
        id: 'sess-1',
        windowId: 'win-1',
        displayName: 'test-session',
        workDir: '/tmp',
        byteOffset: 0,
        monitorOffset: 0,
        status: 'running',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        stallThresholdMs: 300_000,
        permissionMode: 'default',
      };
      const deps = createMockDeps({ 'sess-1': session });
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, join(tmpDir, 'map.json'));

      discovery.startDiscoveryPolling('sess-1', '/tmp');
      discovery.stopDiscoveryPolling('sess-1');

      // Verify timer was cleared — no more polling
      expect((discovery as any).pollTimers.has('sess-1')).toBe(false);
      expect((discovery as any).discoveryTimeouts.has('sess-1')).toBe(false);
    });
  });

  describe('startDiscoveryPolling', () => {
    it('stops polling when session becomes null', async () => {
      vi.useFakeTimers();

      const deps = createMockDeps(); // no sessions
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, join(tmpDir, 'map.json'));

      discovery.startDiscoveryPolling('missing-sess', '/tmp');

      // Advance past first interval (2s)
      await vi.advanceTimersByTimeAsync(3_000);

      // Timer should have been cleaned up since session is null
      expect((discovery as any).pollTimers.has('missing-sess')).toBe(false);

      vi.useRealTimers();
    });

    it('stops polling when session already has claudeSessionId and jsonlPath', async () => {
      vi.useFakeTimers();

      const completeSession: SessionInfo = {
        id: 'sess-complete',
        windowId: 'win-2',
        displayName: 'complete-session',
        workDir: '/tmp',
        byteOffset: 0,
        monitorOffset: 0,
        status: 'running',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        stallThresholdMs: 300_000,
        permissionMode: 'default',
        claudeSessionId: 'cc-123',
        jsonlPath: '/tmp/test.jsonl',
      };
      const deps = createMockDeps({ 'sess-complete': completeSession });
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, join(tmpDir, 'map.json'));

      discovery.startDiscoveryPolling('sess-complete', '/tmp');

      // Advance past first interval
      await vi.advanceTimersByTimeAsync(3_000);

      // Should have stopped — session already has both fields
      expect((discovery as any).pollTimers.has('sess-complete')).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('cleanSessionMapForWindow', () => {
    it('is a no-op when map file does not exist', async () => {
      const deps = createMockDeps();
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, join(tmpDir, 'nonexistent-map.json'));

      await expect(discovery.cleanSessionMapForWindow('test-window')).resolves.toBeUndefined();
    });

    it('cleans entries by windowName', async () => {
      const mapFile = join(tmpDir, 'session_map.json');
      writeFileSync(mapFile, JSON.stringify({
        'test-window:win-1': validMapEntry({ window_name: 'test-window', session_id: 'cc-1' }),
        'other-window:win-2': validMapEntry({ window_name: 'other-window', session_id: 'cc-2' }),
      }));

      const deps = createMockDeps();
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, mapFile);

      await discovery.cleanSessionMapForWindow('test-window');

      const { default: fs } = await import('node:fs/promises');
      const content = JSON.parse(await fs.readFile(mapFile, 'utf-8'));
      expect(content['test-window:win-1']).toBeUndefined();
      expect(content['other-window:win-2']).toBeDefined();
    });

    it('cleans entries by windowId suffix', async () => {
      const mapFile = join(tmpDir, 'session_map.json');
      writeFileSync(mapFile, JSON.stringify({
        'sess-a:@5:win-123': validMapEntry({ window_name: 'sess-a', session_id: 'cc-1' }),
        'sess-b:@10:win-456': validMapEntry({ window_name: 'sess-b', session_id: 'cc-2' }),
      }));

      const deps = createMockDeps();
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, mapFile);

      await discovery.cleanSessionMapForWindow('sess-a', 'win-123');

      const { default: fs } = await import('node:fs/promises');
      const content = JSON.parse(await fs.readFile(mapFile, 'utf-8'));
      expect(content['sess-a:@5:win-123']).toBeUndefined();
      expect(content['sess-b:@10:win-456']).toBeDefined();
    });
  });

  describe('purgeStaleSessionMapEntries', () => {
    it('is a no-op when map file does not exist', async () => {
      const deps = createMockDeps();
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, join(tmpDir, 'nonexistent.json'));

      await expect(
        discovery.purgeStaleSessionMapEntries(new Set(), new Set()),
      ).resolves.toBeUndefined();
    });

    it('removes entries not matching active windows', async () => {
      const mapFile = join(tmpDir, 'session_map.json');
      writeFileSync(mapFile, JSON.stringify({
        'active-sess:win-1': validMapEntry({ window_name: 'Active', session_id: 'cc-1' }),
        'stale-sess:win-2': validMapEntry({ window_name: 'Stale', session_id: 'cc-2' }),
      }));

      const deps = createMockDeps();
      const config = createConfig();
      const discovery = new SessionDiscovery(deps, config, mapFile);

      await discovery.purgeStaleSessionMapEntries(
        new Set(['win-1']),
        new Set(['Active']),
      );

      const { default: fs } = await import('node:fs/promises');
      const content = JSON.parse(await fs.readFile(mapFile, 'utf-8'));
      expect(content['active-sess:win-1']).toBeDefined();
      expect(content['stale-sess:win-2']).toBeUndefined();
    });
  });
});

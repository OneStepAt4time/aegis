/**
 * Issue #4256: Unit tests for core SessionManager operations.
 *
 * Tests createSession, killSession, approveSession, rejectSession,
 * purgeKilled, and concurrency guarantees using a mock StateStore.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, SessionCreationError } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { Config } from '../config.js';

// ── Module mocks (no file I/O) ─────────────────────────────────────────

vi.mock('../permission-guard.js', () => ({
  neutralizeBypassPermissions: vi.fn().mockResolvedValue(false),
  activateBypassPermissions: vi.fn().mockResolvedValue(false),
  restoreSettings: vi.fn().mockResolvedValue(undefined),
  cleanOrphanedBackup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hook-settings.js', () => ({
  writeHookSettingsFile: vi.fn().mockResolvedValue('/tmp/test-hook-settings.json'),
  cleanupHookSettingsFile: vi.fn().mockResolvedValue(undefined),
  cleanupStaleSessionHooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tenant-workdir.js', () => ({
  validateWorkdirPath: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock('../tracing.js', () => ({
  startSessionSpan: vi.fn().mockReturnValue({ end: vi.fn(), setAttribute: vi.fn() }),
  spanOk: vi.fn(),
  spanError: vi.fn(),
}));

vi.mock('../session-discovery.js', () => ({
  SessionDiscovery: vi.fn().mockImplementation(function (this: unknown, _deps: unknown, _config: unknown, _mapFile: string) {
    (this as Record<string, unknown>).startDiscoveryPolling = vi.fn();
    (this as Record<string, unknown>).stopDiscoveryPolling = vi.fn();
    (this as Record<string, unknown>).cleanSessionMapForWindow = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../session-transcripts.js', () => ({
  SessionTranscripts: vi.fn().mockImplementation(function (this: unknown, _config: unknown) {
    (this as Record<string, unknown>).clearCache = vi.fn();
    (this as Record<string, unknown>).readMessages = vi.fn().mockResolvedValue([]);
  }),
}));

vi.mock('../base-url.js', () => ({
  getConfiguredBaseUrl: vi.fn().mockReturnValue('http://localhost:9100'),
}));

vi.mock('../fault-injection.js', () => ({
  maybeInjectFault: vi.fn(),
}));

vi.mock('../transcript.js', () => ({
  readNewEntries: vi.fn().mockResolvedValue([]),
}));

// ── Helpers ────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    baseUrl: 'http://localhost:9100',
    port: 9100,
    host: 'localhost',
    authToken: '',
    stateDir: '/tmp/aegis-test-state',
    claudeProjectsDir: '/tmp/.claude/projects',
    maxSessionAgeMs: 86_400_000,
    reaperIntervalMs: 3_600_000,
    continuationPointerTtlMs: 3_600_000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 0,
    tgTopicAutoDelete: true,
    tgVerbose: false,
    tgTopicTTLHours: 0,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'bypassPermissions',
    stallThresholdMs: 120_000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    metricsToken: '',
    pipelineStageTimeoutMs: 0,
    alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 600_000 },
    envDenylist: [],
    envAdminAllowlist: [],
    enforceSessionOwnership: false,
    strictRBAC: false,
    requireSessionApproval: false,
    sessionApprovalTimeoutMs: 300_000,
    sessionCleanupIntervalMs: 3_600_000,
    sessionCleanupAgeMs: 86_400_000,
    sseIdleMs: 60_000,
    sseClientTimeoutMs: 300_000,
    hookTimeoutMs: 10_000,
    shutdownGraceMs: 15_000,
    keyRotationGraceSeconds: 3600,
    shutdownHardMs: 20_000,
    stateStore: 'file',
    postgresUrl: '',
    ...overrides,
  } as Config;
}

function makeStore() {
  return {
    load: vi.fn().mockResolvedValue({ sessions: {} }),
    save: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({ status: 'healthy' }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Issue #4256: SessionManager core operations', () => {
  let manager: SessionManager;
  let store: ReturnType<typeof makeStore>;
  let config: Config;

  beforeEach(() => {
    store = makeStore();
    config = makeConfig();
    manager = new SessionManager(config, store as unknown as ConstructorParameters<typeof SessionManager>[1]);
  });

  // ── createSession ──────────────────────────────────────────────────

  describe('createSession', () => {
    it('creates session with correct metadata', async () => {
      const session = await manager.createSession({
        id: 's-1',
        workDir: '/tmp/my-project',
        name: 'Test Session',
      });

      expect(session.id).toBe('s-1');
      expect(session.workDir).toBe('/tmp/my-project');
      expect(session.displayName).toBe('Test Session');
      expect(session.status).toBe('pending');
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.lastActivity).toBeGreaterThan(0);
    });

    it('persists initial state via store save', async () => {
      await manager.createSession({ id: 's-1', workDir: '/tmp/my-project' });
      expect(store.save).toHaveBeenCalled();
    });

    it('uses provided id when specified', async () => {
      const session = await manager.createSession({
        id: 'custom-id-123',
        workDir: '/tmp/my-project',
      });
      expect(session.id).toBe('custom-id-123');
    });

    it('defaults displayName to basename of workDir', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/my-cool-project' });
      expect(session.displayName).toBe('my-cool-project');
    });

    it('de-duplicates display names within same tenant', async () => {
      await manager.createSession({ id: 's-1', workDir: '/tmp/p1', name: 'dup' });
      const session2 = await manager.createSession({ id: 's-2', workDir: '/tmp/p2', name: 'dup' });
      expect(session2.displayName).toBe('dup-1');
    });

    it('sets status to awaiting_approval when approval required', async () => {
      const approvalConfig = makeConfig({ requireSessionApproval: true });
      const approvalManager = new SessionManager(approvalConfig, store as unknown as ConstructorParameters<typeof SessionManager>[1]);

      const session = await approvalManager.createSession({ id: 's-1', workDir: '/tmp/project' });
      expect(session.status).toBe('awaiting_approval');
      expect(session.awaitingApproval).toBe(true);
    });

    it('rejects dangerous env var names', async () => {
      await expect(
        manager.createSession({ id: 's-1', workDir: '/tmp/project', env: { 'bad-name': 'value' } }),
      ).rejects.toThrow(/Invalid env var name/);
    });

    it('rejects dangerous env vars from denylist', async () => {
      await expect(
        manager.createSession({ id: 's-1', workDir: '/tmp/project', env: { PATH: '/evil' } }),
      ).rejects.toThrow(/Forbidden env var/);
    });

    it('rejects env values with CR/LF', async () => {
      await expect(
        manager.createSession({ id: 's-1', workDir: '/tmp/project', env: { MY_VAR: 'val\r\ninjection' } }),
      ).rejects.toThrow(/CR\/LF/);
    });

    it('rejects env values with control characters', async () => {
      await expect(
        manager.createSession({ id: 's-1', workDir: '/tmp/project', env: { MY_VAR: 'val\x00ue' } }),
      ).rejects.toThrow(/control character/);
    });

    it('registers child with parent session', async () => {
      const parent = await manager.createSession({ id: 's-parent', workDir: '/tmp/project', name: 'parent' });
      const child = await manager.createSession({
        id: 's-child',
        workDir: '/tmp/project',
        name: 'child',
        parentId: parent.id,
      });

      const updatedParent = manager.getSession(parent.id);
      expect(updatedParent?.children).toContain(child.id);
    });

    it('stores ownerKeyId when provided', async () => {
      const session = await manager.createSession({
        id: 's-1',
        workDir: '/tmp/project',
        ownerKeyId: 'key-abc',
      });
      expect(session.ownerKeyId).toBe('key-abc');
    });

    it('stores tenantId when provided', async () => {
      const session = await manager.createSession({
        id: 's-1',
        workDir: '/tmp/project',
        tenantId: 'tenant-1',
      });
      expect(session.tenantId).toBe('tenant-1');
    });

    it('stores model and effort when provided', async () => {
      const session = await manager.createSession({
        id: 's-1',
        workDir: '/tmp/project',
        model: 'claude-sonnet-4-6',
        effort: 'high',
      });
      expect(session.model).toBe('claude-sonnet-4-6');
      expect(session.effort).toBe('high');
    });

    it('stores runnerName when provided', async () => {
      const session = await manager.createSession({
        id: 's-1',
        workDir: '/tmp/project',
        runnerName: 'claude-code',
      });
      expect(session.runnerName).toBe('claude-code');
    });
  });

  // ── killSession ────────────────────────────────────────────────────

  describe('killSession', () => {
    it('marks session as killed', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      await manager.killSession(session.id);

      const killed = manager.getSession(session.id);
      expect(killed?.status).toBe('killed');
    });

    it('persists killed state via save', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      store.save.mockClear();
      await manager.killSession(session.id);
      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('returns silently if session not found', async () => {
      await expect(manager.killSession('nonexistent')).resolves.toBeUndefined();
    });

    it('restores settings when settingsPatched is true', async () => {
      const { restoreSettings } = await import('../permission-guard.js');
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });

      // Simulate patched settings
      const s = manager.getSession(session.id)!;
      (s as unknown as Record<string, unknown>).settingsPatched = true;

      await manager.killSession(session.id);
      expect(restoreSettings).toHaveBeenCalledWith('/tmp/project');
    });

    it('does not restore settings when settingsPatched is false', async () => {
      const { restoreSettings } = await import('../permission-guard.js');
      (restoreSettings as ReturnType<typeof vi.fn>).mockClear();

      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      const s = manager.getSession(session.id)!;
      (s as unknown as Record<string, unknown>).settingsPatched = false;

      await manager.killSession(session.id);
      expect(restoreSettings).not.toHaveBeenCalled();
    });

    it('updates lastActivity on kill', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      const beforeKill = session.lastActivity;

      await manager.killSession(session.id);

      const killed = manager.getSession(session.id)!;
      expect(killed.lastActivity).toBeGreaterThanOrEqual(beforeKill);
    });
  });

  // ── approveSession ─────────────────────────────────────────────────

  describe('approveSession', () => {
    function makeApprovalManager() {
      const approvalConfig = makeConfig({ requireSessionApproval: true });
      const s = makeStore();
      const m = new SessionManager(approvalConfig, s as unknown as ConstructorParameters<typeof SessionManager>[1]);
      return { manager: m, store: s };
    }

    it('transitions awaiting_approval to pending', async () => {
      const { manager: am } = makeApprovalManager();
      const session = await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      expect(session.status).toBe('awaiting_approval');

      const approved = await am.approveSession(session.id, 'admin');
      expect(approved.status).toBe('pending');
      expect(approved.approvedBy).toBe('admin');
      expect(approved.approvedAt).toBeGreaterThan(0);
      expect(approved.awaitingApproval).toBe(false);
    });

    it('persists approved state', async () => {
      const { manager: am, store: s } = makeApprovalManager();
      const session = await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      s.save.mockClear();

      await am.approveSession(session.id);
      expect(s.save).toHaveBeenCalledTimes(1);
    });

    it('throws if session not found', async () => {
      const { manager: am } = makeApprovalManager();
      await expect(am.approveSession('nonexistent')).rejects.toThrow('Session not found');
    });

    it('throws if session is not awaiting approval', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      // Session is 'pending', not 'awaiting_approval'
      await expect(manager.approveSession(session.id)).rejects.toThrow('not awaiting approval');
    });

    it('records approvedBy when provided', async () => {
      const { manager: am } = makeApprovalManager();
      await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      const approved = await am.approveSession('s-1', 'user-42');
      expect(approved.approvedBy).toBe('user-42');
    });

    it('starts discovery polling after approval', async () => {
      const { manager: am } = makeApprovalManager();
      await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      await am.approveSession('s-1');

      const { SessionDiscovery } = await import('../session-discovery.js');
      const results = (SessionDiscovery as ReturnType<typeof vi.fn>).mock.results;
      const mockDiscovery = results[results.length - 1].value;
      expect(mockDiscovery.startDiscoveryPolling).toHaveBeenCalledWith('s-1', '/tmp/project');
    });
  });

  // ── rejectSession ──────────────────────────────────────────────────

  describe('rejectSession', () => {
    function makeApprovalManager() {
      const approvalConfig = makeConfig({ requireSessionApproval: true });
      const s = makeStore();
      const m = new SessionManager(approvalConfig, s as unknown as ConstructorParameters<typeof SessionManager>[1]);
      return { manager: m, store: s };
    }

    it('transitions awaiting_approval to killed', async () => {
      const { manager: am } = makeApprovalManager();
      const session = await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      expect(session.status).toBe('awaiting_approval');

      await am.rejectSession(session.id);
      const rejected = am.getSession(session.id)!;
      expect(rejected.status).toBe('killed');
      expect(rejected.awaitingApproval).toBe(false);
    });

    it('persists rejected state', async () => {
      const { manager: am, store: s } = makeApprovalManager();
      await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      s.save.mockClear();

      await am.rejectSession('s-1');
      expect(s.save).toHaveBeenCalledTimes(1);
    });

    it('throws if session not found', async () => {
      const { manager: am } = makeApprovalManager();
      await expect(am.rejectSession('nonexistent')).rejects.toThrow('Session not found');
    });

    it('throws if session is not awaiting approval', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      await expect(manager.rejectSession(session.id)).rejects.toThrow('not awaiting approval');
    });
  });

  // ── purgeKilled ────────────────────────────────────────────────────

  describe('purgeKilled', () => {
    it('removes killed sessions older than threshold', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      const s = manager.getSession(session.id)!;
      s.status = 'killed';
      s.lastActivity = Date.now() - 100_000;

      const purged = await manager.purgeKilled(50_000);
      expect(purged).toBe(1);
      expect(manager.getSession(session.id)).toBeNull();
    });

    it('keeps killed sessions newer than threshold', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      const s = manager.getSession(session.id)!;
      s.status = 'killed';
      s.lastActivity = Date.now() - 10_000;

      const purged = await manager.purgeKilled(50_000);
      expect(purged).toBe(0);
      expect(manager.getSession(session.id)).not.toBeNull();
    });

    it('keeps non-killed sessions regardless of age', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      // Status is 'pending'

      const purged = await manager.purgeKilled(0);
      expect(purged).toBe(0);
      expect(manager.getSession(session.id)).not.toBeNull();
    });

    it('returns correct count when multiple sessions purged', async () => {
      const s1 = await manager.createSession({ id: 's-1', workDir: '/tmp/p1', name: 'a' });
      const s2 = await manager.createSession({ id: 's-2', workDir: '/tmp/p2', name: 'b' });
      const s3 = await manager.createSession({ id: 's-3', workDir: '/tmp/p3', name: 'c' });

      manager.getSession(s1.id)!.status = 'killed';
      manager.getSession(s1.id)!.lastActivity = Date.now() - 100_000;
      manager.getSession(s2.id)!.status = 'killed';
      manager.getSession(s2.id)!.lastActivity = Date.now() - 100_000;
      // s3 stays pending

      const purged = await manager.purgeKilled(50_000);
      expect(purged).toBe(2);
      expect(manager.getSession(s1.id)).toBeNull();
      expect(manager.getSession(s2.id)).toBeNull();
      expect(manager.getSession(s3.id)).not.toBeNull();
    });

    it('saves state only when sessions were purged', async () => {
      // No killed sessions → no save
      store.save.mockClear();
      await manager.purgeKilled(50_000);
      expect(store.save).not.toHaveBeenCalled();

      // Create and kill a session
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      manager.getSession(session.id)!.status = 'killed';
      manager.getSession(session.id)!.lastActivity = Date.now() - 100_000;

      store.save.mockClear();
      await manager.purgeKilled(50_000);
      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('falls back to createdAt when lastActivity is missing', async () => {
      const session = await manager.createSession({ id: 's-1', workDir: '/tmp/project' });
      const s = manager.getSession(session.id)!;
      s.status = 'killed';
      s.lastActivity = undefined as unknown as number;
      // createdAt is recent, so session is new
      s.createdAt = Date.now() - 100_000;

      const purged = await manager.purgeKilled(50_000);
      expect(purged).toBe(1);
      expect(manager.getSession(session.id)).toBeNull();
    });
  });

  // ── Concurrency ────────────────────────────────────────────────────

  describe('concurrency', () => {
    it('concurrent approve and reject produce deterministic winner', async () => {
      const approvalConfig = makeConfig({ requireSessionApproval: true });
      const s = makeStore();
      const am = new SessionManager(approvalConfig, s as unknown as ConstructorParameters<typeof SessionManager>[1]);

      const session = await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      expect(session.status).toBe('awaiting_approval');

      const [approveResult, rejectResult] = await Promise.allSettled([
        am.approveSession(session.id, 'user1'),
        am.rejectSession(session.id),
      ]);

      // One must succeed and one must fail
      const successes = [approveResult, rejectResult].filter(r => r.status === 'fulfilled').length;
      const failures = [approveResult, rejectResult].filter(r => r.status === 'rejected').length;
      expect(successes).toBe(1);
      expect(failures).toBe(1);

      // Final state is deterministic: either pending or killed, not awaiting_approval
      const finalSession = am.getSession(session.id)!;
      expect(['pending', 'killed']).toContain(finalSession.status);
      expect(finalSession.awaitingApproval).toBe(false);
    });

    it('second approve after first approve throws', async () => {
      const approvalConfig = makeConfig({ requireSessionApproval: true });
      const s = makeStore();
      const am = new SessionManager(approvalConfig, s as unknown as ConstructorParameters<typeof SessionManager>[1]);

      const session = await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      await am.approveSession(session.id, 'user1');

      await expect(am.approveSession(session.id, 'user2')).rejects.toThrow('not awaiting approval');
    });

    it('second reject after first reject throws', async () => {
      const approvalConfig = makeConfig({ requireSessionApproval: true });
      const s = makeStore();
      const am = new SessionManager(approvalConfig, s as unknown as ConstructorParameters<typeof SessionManager>[1]);

      const session = await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      await am.rejectSession(session.id);

      await expect(am.rejectSession(session.id)).rejects.toThrow('not awaiting approval');
    });

    it('approve after reject throws', async () => {
      const approvalConfig = makeConfig({ requireSessionApproval: true });
      const s = makeStore();
      const am = new SessionManager(approvalConfig, s as unknown as ConstructorParameters<typeof SessionManager>[1]);

      const session = await am.createSession({ id: 's-1', workDir: '/tmp/project' });
      await am.rejectSession(session.id);

      await expect(am.approveSession(session.id)).rejects.toThrow('not awaiting approval');
    });
  });
});

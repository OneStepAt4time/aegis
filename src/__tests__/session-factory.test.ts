/**
 * Tests for session-factory.ts — buildSessionInfo
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSessionInfo, SessionCreationError, resetCleanupCache, type CreateSessionOpts } from '../services/session/session-factory.js';
import type { Config } from '../config.js';
import type { ExistingSessionRef } from '../services/session/session-factory.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Mock permission-guard to avoid actual file writes
vi.mock('../permission-guard.js', () => ({
  neutralizeBypassPermissions: vi.fn().mockResolvedValue(false),
  activateBypassPermissions: vi.fn().mockResolvedValue(true),
  restoreSettings: vi.fn(),
  cleanOrphanedBackup: vi.fn(),
}));

// Mock hook-settings to avoid actual file writes
vi.mock('../hook-settings.js', () => ({
  writeHookSettingsFile: vi.fn().mockResolvedValue('/tmp/hooks.json'),
  cleanupStaleSessionHooks: vi.fn().mockResolvedValue(undefined),
}));

// Mock session-helpers
vi.mock('../session-helpers.js', () => ({
  detectIsolationMode: vi.fn().mockResolvedValue('worktree'),
  detectModelFromSettings: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  hydrateSessions: vi.fn(),
  isObjectRecord: vi.fn(),
  getUiApprovalInput: vi.fn(),
}));

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    defaultPermissionMode: 'default',
    defaultSessionEnv: {},
    isolationPolicy: 'respect-cc',
    ...overrides,
  } as Config;
}

function makeOpts(overrides: Partial<CreateSessionOpts> = {}): CreateSessionOpts {
  return {
    workDir: '/tmp/test-workdir',
    tenantId: 'default',
    ...overrides,
  };
}

describe('buildSessionInfo', () => {
  beforeEach(() => {
    resetCleanupCache();
    vi.clearAllMocks();
  });

  it('creates a session with default values', async () => {
    const config = makeConfig();
    const opts = makeOpts();
    const { session } = await buildSessionInfo('test-id-1234', opts, config, [], new Set());

    expect(session.id).toBe('test-id-1234');
    expect(session.workDir).toBe('/tmp/test-workdir');
    expect(session.tenantId).toBe('default');
    expect(session.status).toBe('pending');
    expect(session.windowId).toBe('');
    expect(session.permissionMode).toBe('default');
    expect(session.isolationMode).toBe('worktree');
    expect(session.settingsPatched).toBe(false);
    expect(session.hookSecret).toBeTruthy();
    expect(session.hookSecret).toHaveLength(64); // 32 bytes hex
  });

  it('uses explicit name when provided', async () => {
    const config = makeConfig();
    const opts = makeOpts({ name: 'My Session' });
    const { session } = await buildSessionInfo('id', opts, config, [], new Set());

    expect(session.displayName).toBe('My Session');
  });

  it('falls back to basename of workDir for display name', async () => {
    const config = makeConfig();
    const opts = makeOpts({ name: undefined, workDir: '/home/user/projects/my-app' });
    const { session } = await buildSessionInfo('id', opts, config, [], new Set());

    expect(session.displayName).toBe('my-app');
  });

  it('deduplicates display names within same tenant', async () => {
    const config = makeConfig();
    const opts = makeOpts({ name: 'Test' });
    const existing: ExistingSessionRef[] = [
      { id: 'old-1', tenantId: 'default', displayName: 'Test' },
    ];

    const { session } = await buildSessionInfo('new-id', opts, config, existing, new Set());
    expect(session.displayName).toBe('Test-1');
  });

  it('does not deduplicate across different tenants', async () => {
    const config = makeConfig();
    const opts = makeOpts({ name: 'Test', tenantId: 'tenant-B' });
    const existing: ExistingSessionRef[] = [
      { id: 'old-1', tenantId: 'tenant-A', displayName: 'Test' },
    ];

    const { session } = await buildSessionInfo('new-id', opts, config, existing, new Set());
    expect(session.displayName).toBe('Test');
  });

  it('uses bypassPermissions when permissionMode is set', async () => {
    const { activateBypassPermissions } = await import('../permission-guard.js');
    const config = makeConfig();
    const opts = makeOpts({ permissionMode: 'bypassPermissions' });

    const { session } = await buildSessionInfo('id', opts, config, [], new Set());
    expect(session.permissionMode).toBe('bypassPermissions');
    expect(session.settingsPatched).toBe(true);
    expect(activateBypassPermissions).toHaveBeenCalled();
  });

  it('uses autoApprove=true as bypassPermissions', async () => {
    const { activateBypassPermissions } = await import('../permission-guard.js');
    const config = makeConfig();
    const opts = makeOpts({ autoApprove: true });

    const { session } = await buildSessionInfo('id', opts, config, [], new Set());
    expect(session.permissionMode).toBe('bypassPermissions');
    expect(activateBypassPermissions).toHaveBeenCalled();
  });

  it('throws SessionCreationError for enforce-worktree policy with none isolation', async () => {
    const { detectIsolationMode } = await import('../session-helpers.js');
    (detectIsolationMode as ReturnType<typeof vi.fn>).mockResolvedValueOnce('none');

    const config = makeConfig({ isolationPolicy: 'enforce-worktree' });
    const opts = makeOpts();

    await expect(buildSessionInfo('id', opts, config, [], new Set())).rejects.toThrow(SessionCreationError);
  });

  it('forces isolationMode to none when policy is enforce-direct', async () => {
    const { detectIsolationMode } = await import('../session-helpers.js');
    (detectIsolationMode as ReturnType<typeof vi.fn>).mockResolvedValueOnce('worktree');

    const config = makeConfig({ isolationPolicy: 'enforce-direct' });
    const opts = makeOpts();

    const { session } = await buildSessionInfo('id', opts, config, [], new Set());
    expect(session.isolationMode).toBe('none');
    expect(session.isolationPolicy).toBe('enforce-direct');
  });

  it('carries over model from resumed session', async () => {
    const config = makeConfig();
    const opts = makeOpts({ resumeSessionId: 'old-session', model: undefined });
    const existing: ExistingSessionRef[] = [
      { id: 'old-session', tenantId: 'default', displayName: 'Old', model: 'claude-opus-4' },
    ];

    const { session } = await buildSessionInfo('new-id', opts, config, existing, new Set());
    expect(session.model).toBe('claude-opus-4');
  });

  it('does not override explicit model with resume carryover', async () => {
    const config = makeConfig();
    const opts = makeOpts({ resumeSessionId: 'old-session', model: 'claude-haiku' });
    const existing: ExistingSessionRef[] = [
      { id: 'old-session', tenantId: 'default', displayName: 'Old', model: 'claude-opus-4' },
    ];

    const { session } = await buildSessionInfo('new-id', opts, config, existing, new Set());
    expect(session.model).toBe('claude-haiku');
  });

  it('uses custom stall thresholds when provided', async () => {
    const config = makeConfig();
    const opts = makeOpts({ stallThresholdMs: 60000, permissionStallMs: 120000 });

    const { session } = await buildSessionInfo('id', opts, config, [], new Set());
    expect(session.stallThresholdMs).toBe(60000);
    expect(session.permissionStallMs).toBe(120000);
  });

  it('detects model from settings when not provided', async () => {
    const { detectModelFromSettings } = await import('../session-helpers.js');
    (detectModelFromSettings as ReturnType<typeof vi.fn>).mockResolvedValueOnce('detected-model');

    const config = makeConfig();
    const opts = makeOpts({ model: undefined });

    const { session } = await buildSessionInfo('id', opts, config, [], new Set());
    expect(session.model).toBe('detected-model');
  });

  it('truncates display name to 200 chars', async () => {
    const config = makeConfig();
    const longName = 'A'.repeat(300);
    const opts = makeOpts({ name: longName });

    const { session } = await buildSessionInfo('id', opts, config, [], new Set());
    expect(session.displayName.length).toBeLessThanOrEqual(200);
  });
});

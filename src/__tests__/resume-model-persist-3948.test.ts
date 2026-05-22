/**
 * resume-model-persist-3948.test.ts
 *
 * Tests that when a session is resumed via resumeSessionId, the model and
 * effort fields are carried over from the original session.
 *
 * Issue #3948: ensure per-session model persistence on resume.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Mock tmux backend before importing SessionManager
vi.mock('../tmux.js', () => ({
  TmuxRunner: vi.fn().mockImplementation(() => ({
    ensureSession: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockResolvedValue([]),
    createWindow: vi.fn().mockResolvedValue({ windowId: '@1', displayName: 'mock', freshSessionId: 'mock-cc' }),
    capturePane: vi.fn().mockResolvedValue(''),
    capturePaneDirect: vi.fn().mockResolvedValue(''),
    listPanePid: vi.fn().mockResolvedValue(12345),
    isPidAlive: vi.fn().mockResolvedValue(true),
    getWindowHealth: vi.fn().mockResolvedValue({ windowExists: true, paneCommand: null, claudeRunning: false, paneDead: false }),
    windowExists: vi.fn().mockResolvedValue(true),
    sendKeys: vi.fn().mockResolvedValue({ success: true }),
    sendKeysVerified: vi.fn().mockResolvedValue({ delivered: true, attempts: 1 }),
    sendSpecialKey: vi.fn().mockResolvedValue({ success: true }),
    killWindow: vi.fn().mockResolvedValue({ success: true }),
    killSession: vi.fn().mockResolvedValue({ success: true }),
    isServerHealthy: vi.fn().mockResolvedValue({ healthy: true, error: null }),
    isTmuxServerError: vi.fn().mockReturnValue(false),
  })),
}));

// Mock hook settings writing
vi.mock('../hooks.js', async () => {
  const actual = await vi.importActual('../hooks.js');
  return {
    ...actual,
    writeHookSettingsFile: vi.fn().mockResolvedValue('/tmp/fake-hooks.json'),
    cleanupStaleSessionHooks: vi.fn().mockResolvedValue(undefined),
  };
});

import { SessionManager } from '../session.js';
import type { Config } from '../config.js';

function makeConfig(stateDir: string): Config {
  return {
    port: 0, host: '127.0.0.1', authToken: 'test-token',
    stateDir,
    claudeProjectsDir: join(stateDir, 'projects'),
    maxSessionAgeMs: 2 * 60 * 60 * 1000, reaperIntervalMs: 60 * 60 * 1000,
    continuationPointerTtlMs: 24 * 60 * 60 * 1000,
    tgBotToken: '', tgGroupId: '', tgAllowedUsers: [], tgTopicTtlMs: 0,
    tgTopicAutoDelete: true, tgVerbose: false, tgTopicTTLHours: 0,
    stallThresholdMs: 5 * 60 * 1000, defaultPermissionMode: 'default',
    allowedWorkDirs: [], defaultSessionEnv: {}, metricsToken: '',
    hookSecretHeaderOnly: false, pipelineStageTimeoutMs: 30_000,
    webhooks: [], sseMaxConnections: 100, sseMaxPerIp: 10,
    memoryBridge: { enabled: false }, worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 600_000 },
    envDenylist: [], envAdminAllowlist: [], enforceSessionOwnership: false,
    strictRBAC: false,
    sseIdleMs: 60_000, sseClientTimeoutMs: 300_000, hookTimeoutMs: 10_000,
    shutdownGraceMs: 15_000, keyRotationGraceSeconds: 3600, shutdownHardMs: 20_000,
    acpPromptTimeoutMs: 120_000,
    rateLimit: { enabled: false, sessionsMax: 100, generalMax: 30, timeWindowSec: 60 },
    stateStore: 'file', postgresUrl: '', defaultTenantId: 'default', acpEnabled: false,
    tenantWorkdirs: {},
  } satisfies Config;
}

describe('Resume session model persistence (#3948)', () => {
  let tmpDir: string;
  let sessions: SessionManager;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-resume-3948-'));
    sessions = new SessionManager(makeConfig(tmpDir));
    await sessions.load();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it('carries over model from original session on resume', async () => {
    // Create original session with explicit model
    const original = await sessions.createSession({
      workDir: tmpDir,
      name: 'original',
      model: 'claude-sonnet-4-20250514',
    });

    // Resume without specifying model
    const resumed = await sessions.createSession({
      workDir: tmpDir,
      name: 'resumed',
      resumeSessionId: original.id,
    });

    expect(resumed.model).toBe('claude-sonnet-4-20250514');
  });

  it('carries over effort from original session on resume', async () => {
    const original = await sessions.createSession({
      workDir: tmpDir,
      name: 'original',
      model: 'claude-opus-4',
      effort: 'high',
    });

    const resumed = await sessions.createSession({
      workDir: tmpDir,
      name: 'resumed',
      resumeSessionId: original.id,
    });

    expect(resumed.model).toBe('claude-opus-4');
    expect(resumed.effort).toBe('high');
  });

  it('explicit model override wins over resume carry-over', async () => {
    const original = await sessions.createSession({
      workDir: tmpDir,
      name: 'original',
      model: 'claude-sonnet-4-20250514',
    });

    const resumed = await sessions.createSession({
      workDir: tmpDir,
      name: 'resumed',
      resumeSessionId: original.id,
      model: 'claude-haiku-3.5',
    });

    // Explicit override should win
    expect(resumed.model).toBe('claude-haiku-3.5');
  });

  it('explicit effort override wins over resume carry-over', async () => {
    const original = await sessions.createSession({
      workDir: tmpDir,
      name: 'original',
      model: 'claude-sonnet-4',
      effort: 'high',
    });

    const resumed = await sessions.createSession({
      workDir: tmpDir,
      name: 'resumed',
      resumeSessionId: original.id,
      effort: 'low',
    });

    expect(resumed.model).toBe('claude-sonnet-4'); // carried over
    expect(resumed.effort).toBe('low'); // explicit override
  });

  it('uses detected model when no resume and no explicit model', async () => {
    // No model, no resume — should use whatever detectedModel returns (undefined in test)
    const session = await sessions.createSession({
      workDir: tmpDir,
      name: 'fresh',
    });

    // detectedModel will be undefined in test (no CC settings files)
    // so model should be undefined
    expect(session.model).toBeUndefined();
  });

  it('handles resume of non-existent session gracefully', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const session = await sessions.createSession({
      workDir: tmpDir,
      name: 'resumed-nope',
      resumeSessionId: fakeId,
    });

    // Should not throw — just no carry-over
    expect(session.id).toBeDefined();
    expect(session.model).toBeUndefined();
  });
});

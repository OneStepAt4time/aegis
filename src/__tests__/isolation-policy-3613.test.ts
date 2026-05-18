/**
 * isolation-policy-3613.test.ts — Tests for Issue #3613.
 *
 * Session isolation policy enforcement:
 *   - "respect-cc": use detected isolation mode as-is (default, no behavior change)
 *   - "enforce-worktree": reject session creation when bgIsolation="none"
 *   - "enforce-direct": force isolationMode to "none" regardless of CC settings
 *
 * Also tests per-session override via isolationPolicy in createSession opts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager, SessionCreationError } from '../session.js';
import type { Config } from '../config.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

function makeMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 9100,
    host: '127.0.0.1',
    authToken: '',
    stateDir: join(tmpdir(), `aegis-test-3613-${Date.now()}`),
    claudeProjectsDir: '/tmp/.claude/projects',
    maxSessionAgeMs: 7200000,
    reaperIntervalMs: 300000,
    continuationPointerTtlMs: 300000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 300000,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'default',
    stallThresholdMs: 300000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    ...overrides,
  } as unknown as Config;
}

/**
 * Create a temp directory with a .claude/settings.json that sets bgIsolation.
 */
function createWorkdirWithIsolation(bgIsolation: 'none' | 'worktree'): string {
  const workDir = mkdtempSync(join(tmpdir(), 'aegis-wd-3613-'));
  const claudeDir = join(workDir, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, 'settings.json'),
    JSON.stringify({ worktree: { bgIsolation } }),
  );
  return workDir;
}

/**
 * Create a temp workdir WITHOUT any .claude settings (defaults to worktree).
 */
function createDefaultWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'aegis-wd-3613-'));
}

describe('Issue #3613 — Isolation policy enforcement', () => {
  let config: Config;
  let sm: SessionManager;
  const cleanup: string[] = [];

  beforeEach(() => {
    config = makeMockConfig({ isolationPolicy: 'respect-cc' });
    sm = new SessionManager(config);
  });

  afterEach(() => {
    for (const dir of cleanup) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanup.length = 0;
  });

  describe('respect-cc (default)', () => {
    it('allows session with bgIsolation="none" when policy is respect-cc', async () => {
      const workDir = createWorkdirWithIsolation('none');
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'respect-cc';

      const session = await sm.createSession({
        workDir,
        name: 'test-respect-none',
      });

      expect(session.isolationMode).toBe('none');
      expect(session.id).toBeDefined();
    });

    it('allows session with bgIsolation="worktree" when policy is respect-cc', async () => {
      const workDir = createWorkdirWithIsolation('worktree');
      cleanup.push(workDir, config.stateDir);

      const session = await sm.createSession({
        workDir,
        name: 'test-respect-worktree',
      });

      expect(session.isolationMode).toBe('worktree');
    });

    it('defaults to worktree when no CC settings exist', async () => {
      const workDir = createDefaultWorkdir();
      cleanup.push(workDir, config.stateDir);

      const session = await sm.createSession({
        workDir,
        name: 'test-respect-default',
      });

      expect(session.isolationMode).toBe('worktree');
    });
  });

  describe('enforce-worktree', () => {
    it('rejects session when bgIsolation="none" and policy is enforce-worktree', async () => {
      const workDir = createWorkdirWithIsolation('none');
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'enforce-worktree';

      await expect(
        sm.createSession({ workDir, name: 'test-reject' }),
      ).rejects.toThrow(SessionCreationError);

      await expect(
        sm.createSession({ workDir, name: 'test-reject' }),
      ).rejects.toThrow(/enforce-worktree/);
    });

    it('allows session when bgIsolation="worktree" and policy is enforce-worktree', async () => {
      const workDir = createWorkdirWithIsolation('worktree');
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'enforce-worktree';

      const session = await sm.createSession({
        workDir,
        name: 'test-allow',
      });

      expect(session.isolationMode).toBe('worktree');
    });

    it('allows session when no CC settings exist and policy is enforce-worktree', async () => {
      const workDir = createDefaultWorkdir();
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'enforce-worktree';

      const session = await sm.createSession({
        workDir,
        name: 'test-default-allow',
      });

      // No settings → defaults to 'worktree' → allowed
      expect(session.isolationMode).toBe('worktree');
    });
  });

  describe('enforce-direct', () => {
    it('forces isolationMode to "none" regardless of CC settings', async () => {
      const workDir = createWorkdirWithIsolation('worktree');
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'enforce-direct';

      const session = await sm.createSession({
        workDir,
        name: 'test-force-direct',
      });

      // Even though CC settings say worktree, enforce-direct forces none
      expect(session.isolationMode).toBe('none');
    });

    it('forces isolationMode to "none" when no CC settings exist', async () => {
      const workDir = createDefaultWorkdir();
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'enforce-direct';

      const session = await sm.createSession({
        workDir,
        name: 'test-force-direct-default',
      });

      expect(session.isolationMode).toBe('none');
    });
  });

  describe('per-session override', () => {
    it('allows per-session override of global policy', async () => {
      const workDir = createWorkdirWithIsolation('none');
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'enforce-worktree';

      // Global policy would reject, but per-session override allows
      const session = await sm.createSession({
        workDir,
        name: 'test-override',
        isolationPolicy: 'respect-cc',
      });

      expect(session.isolationMode).toBe('none');
    });

    it('per-session enforce-worktree overrides global respect-cc', async () => {
      const workDir = createWorkdirWithIsolation('none');
      cleanup.push(workDir, config.stateDir);
      config.isolationPolicy = 'respect-cc';

      // Global policy would allow, but per-session override rejects
      await expect(
        sm.createSession({
          workDir,
          name: 'test-override-reject',
          isolationPolicy: 'enforce-worktree',
        }),
      ).rejects.toThrow(SessionCreationError);
    });
  });

  describe('SessionCreationError', () => {
    it('has correct name property', () => {
      const err = new SessionCreationError('test');
      expect(err.name).toBe('SessionCreationError');
      expect(err.message).toBe('test');
      expect(err).toBeInstanceOf(Error);
    });
  });
});

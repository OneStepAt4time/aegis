/**
 * Issue #3714 — session.ts isolation mode detection and SessionCreationError
 *
 * Covers:
 * 1. detectIsolationMode() with various CC settings configurations
 * 2. SessionCreationError thrown when isolation policy rejects session
 * 3. createSession isolation policy enforcement (enforce-worktree, enforce-direct, respect-cc)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager, SessionCreationError } from '../session.js';
import { getConfig } from '../config.js';

function createTestSM(stateDir: string, overrides?: Record<string, any>): SessionManager {
  const config = { ...getConfig(), stateDir, authToken: 'test-auth-token', ...overrides };
  return new SessionManager(config);
}

describe('Issue #3714 — isolation mode detection and SessionCreationError', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-iso-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('SessionCreationError', () => {
    it('is an Error subclass with correct name', () => {
      const err = new SessionCreationError('test message');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SessionCreationError);
      expect(err.name).toBe('SessionCreationError');
      expect(err.message).toBe('test message');
    });

    it('can be caught with instanceof check', () => {
      const throwIt = () => { throw new SessionCreationError('rejected'); };
      expect(throwIt).toThrow(SessionCreationError);
      expect(throwIt).toThrow('rejected');
    });
  });

  describe('detectIsolationMode via settings files', () => {
    it('detects bgIsolation="worktree" from project .claude/settings.local.json', async () => {
      const workDir = join(tmpDir, 'project');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.local.json'), JSON.stringify({
        worktree: { bgIsolation: 'worktree' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      expect(session).toBeDefined();
      expect(session.isolationMode).toBe('worktree');
    });

    it('detects bgIsolation="none" from project .claude/settings.json', async () => {
      const workDir = join(tmpDir, 'project2');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'none' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      expect(session.isolationMode).toBe('none');
    });

    it('defaults to worktree when no settings file exists', async () => {
      const workDir = join(tmpDir, 'no-settings');
      mkdirSync(workDir, { recursive: true });

      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      // detectIsolationMode returns undefined → defaults to 'worktree'
      expect(session.isolationMode).toBe('worktree');
    });

    it('ignores settings file with invalid JSON', async () => {
      const workDir = join(tmpDir, 'bad-json');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), '{ bad json }');

      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      // Invalid JSON → falls through → undefined → defaults to 'worktree'
      expect(session.isolationMode).toBe('worktree');
    });

    it('ignores settings with unrecognized bgIsolation value', async () => {
      const workDir = join(tmpDir, 'unknown-val');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'unknown-mode' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      // Unrecognized value → not returned → undefined → defaults to 'worktree'
      expect(session.isolationMode).toBe('worktree');
    });
  });

  describe('enforce-worktree policy', () => {
    it('rejects session when CC settings have bgIsolation="none"', async () => {
      const workDir = join(tmpDir, 'enforce-wt');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'none' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'enforce-worktree' });

      await expect(sm.createSession({ workDir, prd: 'test' }))
        .rejects.toThrow(SessionCreationError);
      await expect(sm.createSession({ workDir, prd: 'test' }))
        .rejects.toThrow(/enforce-worktree/);
    });

    it('allows session when CC settings have bgIsolation="worktree"', async () => {
      const workDir = join(tmpDir, 'enforce-wt-ok');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'worktree' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'enforce-worktree' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      expect(session.isolationMode).toBe('worktree');
    });

    it('allows session when no settings file exists (defaults to worktree)', async () => {
      const workDir = join(tmpDir, 'enforce-wt-default');
      mkdirSync(workDir, { recursive: true });

      const sm = createTestSM(tmpDir, { isolationPolicy: 'enforce-worktree' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      // No settings → undefined → defaults to 'worktree' → allowed
      expect(session.isolationMode).toBe('worktree');
    });
  });

  describe('enforce-direct policy', () => {
    it('overrides worktree isolation to none', async () => {
      const workDir = join(tmpDir, 'enforce-dir');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'worktree' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'enforce-direct' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      expect(session.isolationMode).toBe('none');
    });

    it('keeps none isolation as none', async () => {
      const workDir = join(tmpDir, 'enforce-dir-none');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'none' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'enforce-direct' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      expect(session.isolationMode).toBe('none');
    });
  });

  describe('respect-cc policy', () => {
    it('uses detected worktree mode as-is', async () => {
      const workDir = join(tmpDir, 'respect-cc');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'worktree' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });
      const session = await sm.createSession({ workDir, prd: 'test' });
      expect(session.isolationMode).toBe('worktree');
    });
  });

  describe('per-session isolationPolicy override', () => {
    it('session-level policy overrides server config', async () => {
      const workDir = join(tmpDir, 'per-session');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'worktree' },
      }));

      // Server default is respect-cc, but session requests enforce-direct
      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });
      const session = await sm.createSession({
        workDir,
        prd: 'test',
        isolationPolicy: 'enforce-direct',
      });
      expect(session.isolationMode).toBe('none');
    });

    it('session-level enforce-worktree rejects bgIsolation=none', async () => {
      const workDir = join(tmpDir, 'per-session-reject');
      mkdirSync(workDir, { recursive: true });
      const claudeDir = join(workDir, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
        worktree: { bgIsolation: 'none' },
      }));

      const sm = createTestSM(tmpDir, { isolationPolicy: 'respect-cc' });

      await expect(
        sm.createSession({ workDir, prd: 'test', isolationPolicy: 'enforce-worktree' }),
      ).rejects.toThrow(SessionCreationError);
    });
  });
});

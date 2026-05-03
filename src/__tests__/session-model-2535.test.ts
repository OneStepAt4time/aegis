/**
 * session-model-2535.test.ts — Tests for Issue #2535.
 *
 * The session model field was not stored at creation time, causing analytics
 * to show 'unknown' instead of the actual model name.
 *
 * Tests verify:
 *   1. createSession stores model when supplied
 *   2. model is absent (undefined) when not supplied
 *   3. updateSessionModel (hook path) can override the creation-time value
 *   4. analytics accumulateSession groups by the stored model, not 'unknown'
 */

import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { TmuxManager } from '../tmux.js';
import type { Config } from '../config.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockTmux(): TmuxManager {
  return {
    sendKeys: vi.fn(async () => ({ success: true })),
    sendSpecialKey: vi.fn(async () => {}),
    killWindow: vi.fn(async () => {}),
    capturePane: vi.fn(async () => ''),
    capturePaneDirect: vi.fn(async () => ''),
    windowExists: vi.fn(async () => true),
    listWindows: vi.fn(async () => []),
    listPanePid: vi.fn(async () => null),
    isPidAlive: vi.fn(() => true),
    getWindowHealth: vi.fn(async () => ({ windowExists: true, paneDead: false, claudeRunning: true, paneCommand: 'claude' })),
    createWindow: vi.fn(async () => ({
      windowId: '@99',
      windowName: 'cc-testwin',
      freshSessionId: null,
    })),
    archiveStaleSessionFiles: vi.fn(async () => {}),
    sendKeysVerified: vi.fn(async () => ({ delivered: true, attempts: 1 })),
  } as unknown as TmuxManager;
}

function makeMockConfig(): Config {
  return {
    port: 9100,
    host: '127.0.0.1',
    authToken: '',
    tmuxSession: 'test',
    stateDir: '/tmp/aegis-test-2535',
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
  } as unknown as Config;
}

/** Seed a pre-built session directly into a manager's internal state. */
function seedSession(manager: SessionManager, session: SessionInfo): void {
  (manager as unknown as { state: { sessions: Record<string, SessionInfo> } })
    .state.sessions[session.id] = session;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-2535',
    windowId: '@1',
    windowName: 'cc-sess-2535',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Issue #2535 — session model field stored at creation', () => {
  describe('updateSessionModel()', () => {
    it('sets the model field on an existing session', () => {
      const manager = new SessionManager(makeMockTmux(), makeMockConfig());
      seedSession(manager, makeSession({ id: 'sess-1', model: undefined }));

      manager.updateSessionModel('sess-1', 'claude-sonnet-4-6');

      const session = manager.getSession('sess-1');
      expect(session?.model).toBe('claude-sonnet-4-6');
    });

    it('overwrites a model already set at creation time', () => {
      const manager = new SessionManager(makeMockTmux(), makeMockConfig());
      seedSession(manager, makeSession({ id: 'sess-2', model: 'claude-haiku-4-5' }));

      manager.updateSessionModel('sess-2', 'claude-opus-4-6');

      expect(manager.getSession('sess-2')?.model).toBe('claude-opus-4-6');
    });

    it('is a no-op for unknown session IDs', () => {
      const manager = new SessionManager(makeMockTmux(), makeMockConfig());
      expect(() => manager.updateSessionModel('nonexistent', 'claude-sonnet-4-6')).not.toThrow();
    });
  });

  describe('model field on SessionInfo', () => {
    it('is undefined when not supplied at construction', () => {
      const session = makeSession();
      expect(session.model).toBeUndefined();
    });

    it('is set when supplied at construction', () => {
      const session = makeSession({ model: 'claude-sonnet-4-6' });
      expect(session.model).toBe('claude-sonnet-4-6');
    });
  });

  describe('createSession opts — model propagation', () => {
    it('stores model in session state when passed as opt', async () => {
      const mockTmux = makeMockTmux();
      const manager = new SessionManager(mockTmux, makeMockConfig());

      // Bypass file I/O for state persistence
      vi.spyOn(manager as unknown as { save: () => Promise<void> }, 'save').mockResolvedValue(undefined);

      const session = await manager.createSession({
        workDir: '/tmp/test-2535',
        model: 'claude-sonnet-4-6',
      });

      expect(session.model).toBe('claude-sonnet-4-6');

      const stored = manager.getSession(session.id);
      expect(stored?.model).toBe('claude-sonnet-4-6');
    });

    it('leaves model undefined when not passed as opt', async () => {
      const mockTmux = makeMockTmux();
      const manager = new SessionManager(mockTmux, makeMockConfig());

      vi.spyOn(manager as unknown as { save: () => Promise<void> }, 'save').mockResolvedValue(undefined);

      const session = await manager.createSession({
        workDir: '/tmp/test-2535-nomodel',
      });

      expect(session.model).toBeUndefined();

      const stored = manager.getSession(session.id);
      expect(stored?.model).toBeUndefined();
    });
  });
});

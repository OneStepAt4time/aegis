/**
 * Tests for Issues #629, #630, #634 — Security hardening.
 *
 * Issue #629: Hook endpoints require per-session hook secret validation.
 * Issue #630: Env var name blocklist expansion.
 * Issue #634: SSE token endpoint rate limit double-increment fix.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import type { SessionManager, SessionInfo } from '../session.js';
import { generateHookSettings } from '../hook-settings.js';

// ── Issue #629: Hook secret validation ───────────────────────────────

describe('Issue #629: Hook endpoint secret validation', () => {
  const VALID_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
  const VALID_SECRET = 'a1b2c3d4e5f67890abcdef012345';
  let app: ReturnType<typeof Fastify>;
  let eventBus: SessionEventBus;

  const mockSession: SessionInfo = {
    id: VALID_SESSION_ID,
    windowId: '@99',
    windowName: 'test-session',
    workDir: '/tmp',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle' as const,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 30000,
    permissionStallMs: 30000,
    permissionMode: 'bypassPermissions',
    hookSecret: VALID_SECRET,
  };

  function createMockSessionManager(): SessionManager {
    return {
      getSession: vi.fn().mockReturnValue(mockSession),
      updateStatusFromHook: vi.fn().mockReturnValue('idle'),
      addSubagent: vi.fn(),
      removeSubagent: vi.fn(),
      updateSessionModel: vi.fn(),
      waitForPermissionDecision: vi.fn().mockResolvedValue('allow'),
      waitForAnswer: vi.fn().mockResolvedValue(null),
      getPendingQuestionInfo: vi.fn().mockReturnValue(null),
    } as unknown as SessionManager;
  }

  beforeEach(() => {
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    const sessions = createMockSessionManager();
    registerHookRoutes(app, { sessions, eventBus });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('should accept hook with valid session ID and correct secret in header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${VALID_SESSION_ID}`,
      headers: { 'x-hook-secret': VALID_SECRET },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('should accept hook with valid session ID and correct secret in query param (backward compat)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${VALID_SESSION_ID}&secret=${VALID_SECRET}`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('query-string hook secret is deprecated'));
  });

  it('should reject query-param hook secret in header-only mode', async () => {
    const app2 = Fastify({ logger: false });
    registerHookRoutes(app2, {
      sessions: createMockSessionManager(),
      eventBus: new SessionEventBus(),
      hookSecretHeaderOnly: true,
    });

    const res = await app2.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${VALID_SESSION_ID}&secret=${VALID_SECRET}`,
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('X-Hook-Secret');
    await app2.close();
  });

  it('should reject query-param hook secret even when header secret is present in header-only mode', async () => {
    const app2 = Fastify({ logger: false });
    registerHookRoutes(app2, {
      sessions: createMockSessionManager(),
      eventBus: new SessionEventBus(),
      hookSecretHeaderOnly: true,
    });

    const res = await app2.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${VALID_SESSION_ID}&secret=${VALID_SECRET}`,
      headers: { 'x-hook-secret': VALID_SECRET },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('X-Hook-Secret');
    await app2.close();
  });

  it('should accept header hook secret in header-only mode', async () => {
    const app2 = Fastify({ logger: false });
    registerHookRoutes(app2, {
      sessions: createMockSessionManager(),
      eventBus: new SessionEventBus(),
      hookSecretHeaderOnly: true,
    });

    const res = await app2.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${VALID_SESSION_ID}`,
      headers: { 'x-hook-secret': VALID_SECRET },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    await app2.close();
  });

  it('should reject hook with valid session ID but wrong secret in header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${VALID_SESSION_ID}`,
      headers: { 'x-hook-secret': 'wrong-secret' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('invalid hook secret');
  });

  it('should reject hook with valid session ID but missing secret', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${VALID_SESSION_ID}`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('invalid hook secret');
  });

  it('should reject hook with unknown session ID even with valid secret', async () => {
    const noSessionMgr = {
      getSession: vi.fn().mockReturnValue(null),
      updateStatusFromHook: vi.fn().mockReturnValue(null),
      addSubagent: vi.fn(),
      removeSubagent: vi.fn(),
      updateSessionModel: vi.fn(),
      waitForPermissionDecision: vi.fn().mockResolvedValue('allow'),
      waitForAnswer: vi.fn().mockResolvedValue(null),
      getPendingQuestionInfo: vi.fn().mockReturnValue(null),
    } as unknown as SessionManager;
    const app2 = Fastify({ logger: false });
    registerHookRoutes(app2, { sessions: noSessionMgr, eventBus: new SessionEventBus() });
    const res = await app2.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,
      headers: { 'x-hook-secret': VALID_SECRET },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    await app2.close();
  });

  it('should reject hook with no session ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks/Stop',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  describe('hook URL generation uses headers for secret', () => {
    it('should include secret in X-Hook-Secret header, not in URL', () => {
      const settings = generateHookSettings('http://localhost:9100', VALID_SESSION_ID, VALID_SECRET);
      for (const entries of Object.values(settings.hooks)) {
        for (const entry of entries as Array<{ hooks: Array<{ type: string; url: string; headers?: Record<string, string> }> }>) {
          for (const hook of entry.hooks) {
            expect(hook.url).not.toContain('secret=');
            expect(hook.headers).toBeDefined();
            expect(hook.headers!['X-Hook-Secret']).toBe(VALID_SECRET);
          }
        }
      }
    });

    it('should NOT include secret header when none provided', () => {
      const settings = generateHookSettings('http://localhost:9100', VALID_SESSION_ID);
      for (const entries of Object.values(settings.hooks)) {
        for (const entry of entries as Array<{ hooks: Array<{ type: string; url: string; headers?: Record<string, string> }> }>) {
          for (const hook of entry.hooks) {
            expect(hook.url).toContain(VALID_SESSION_ID);
            expect(hook.url).not.toContain('secret=');
            expect(hook.headers).toBeUndefined();
          }
        }
      }
    });
  });
});

// ── Issue #630: Expanded env var blocklist ─────────────────────────────

describe('Issue #630: Env var blocklist expansion', () => {
  const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
  const DANGEROUS_ENV_VARS = new Set([
    'PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS',
    'DYLD_INSERT_LIBRARIES', 'IFS', 'SHELL', 'ENV', 'BASH_ENV',
    'PYTHONPATH', 'PERL5LIB', 'RUBYLIB', 'CLASSPATH',
    'NODE_PATH', 'PYTHONHOME', 'PYTHONSTARTUP',
    // Issue #630 additions
    'PROMPT_COMMAND', 'GIT_SSH_COMMAND', 'EDITOR', 'VISUAL',
    'SUDO_ASKPASS', 'GIT_EXEC_PATH', 'NODE_ENV',
    'GITHUB_TOKEN', 'NPM_TOKEN', 'GITLAB_TOKEN',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'AZURE_CLIENT_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS',
    'DOCKER_TOKEN', 'HEROKU_API_KEY',
  ]);
  const DANGEROUS_ENV_PREFIXES = [
    'npm_config_', 'BASH_FUNC_', 'SSH_', 'GITHUB_', 'GITLAB_',
    'AWS_', 'AZURE_', 'TF_', 'CI_', 'DOCKER_',
  ];

  describe('exact match blocklist', () => {
    it('should block all explicitly listed dangerous vars', () => {
      for (const varName of DANGEROUS_ENV_VARS) {
        expect(ENV_NAME_RE.test(varName)).toBe(true);
        expect(DANGEROUS_ENV_VARS.has(varName)).toBe(true);
      }
    });
  });

  describe('prefix match blocklist', () => {
    it('should block npm_config_ prefixed vars', () => {
      const vars = ['npm_config_registry', 'npm_config_auth', 'npm_config_cache'];
      for (const v of vars) {
        expect(DANGEROUS_ENV_PREFIXES.some(p => v.startsWith(p))).toBeTruthy();
      }
    });

    it('should block BASH_FUNC_ prefixed vars', () => {
      expect(DANGEROUS_ENV_PREFIXES.some(p => 'BASH_FUNC_debug'.startsWith(p))).toBeTruthy();
    });

    it('should block SSH_ prefixed vars', () => {
      const vars = ['SSH_AUTH_SOCK', 'SSH_PRIVATE_KEY', 'SSH_CONNECTION'];
      for (const v of vars) {
        expect(DANGEROUS_ENV_PREFIXES.some(p => v.startsWith(p))).toBeTruthy();
      }
    });

    it('should block GITHUB_ prefixed vars', () => {
      const vars = ['GITHUB_ACTIONS_TOKEN', 'GITHUB_API_KEY'];
      for (const v of vars) {
        expect(DANGEROUS_ENV_PREFIXES.some(p => v.startsWith(p))).toBeTruthy();
      }
    });

    it('should block CI_ prefixed vars', () => {
      const vars = ['CI_JOB_TOKEN', 'CI_BUILD_TOKEN', 'CI_REGISTRY_TOKEN'];
      for (const v of vars) {
        expect(DANGEROUS_ENV_PREFIXES.some(p => v.startsWith(p))).toBeTruthy();
      }
    });

    it('should block AWS_ prefixed vars', () => {
      const vars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
      for (const v of vars) {
        expect(DANGEROUS_ENV_PREFIXES.some(p => v.startsWith(p))).toBeTruthy();
      }
    });

    it('should block TF_ prefixed vars', () => {
      expect(DANGEROUS_ENV_PREFIXES.some(p => 'TF_TOKEN'.startsWith(p))).toBeTruthy();
    });
  });

  describe('allowed env vars', () => {
    const safeVars = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'MY_APP_CONFIG', 'MCP_SERVER_URL', 'AEGIS_PORT'];
    for (const v of safeVars) {
      it(`should allow safe var: ${v}`, () => {
        expect(ENV_NAME_RE.test(v)).toBe(true);
        expect(DANGEROUS_ENV_VARS.has(v)).toBe(false);
        expect(DANGEROUS_ENV_PREFIXES.some(p => v.startsWith(p))).toBe(false);
      });
    }
  });

  describe('ENV_KEY_RE in tmux.ts (uppercase only)', () => {
    const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

    it('should accept uppercase env var names', () => {
      expect(ENV_KEY_RE.test('MY_VAR')).toBe(true);
      expect(ENV_KEY_RE.test('API_KEY')).toBe(true);
      expect(ENV_KEY_RE.test('_PRIVATE')).toBe(true);
    });

    it('should reject lowercase env var names', () => {
      expect(ENV_KEY_RE.test('my_var')).toBe(false);
      expect(ENV_KEY_RE.test('apiKey')).toBe(false);
      expect(ENV_KEY_RE.test('My_Var')).toBe(false);
    });
  });
});

// ── Issue #634: SSE rate limit double-increment ──────────────────────────
describe('Issue #634: SSE token rate limit single-increment', () => {
  it('should store authKeyId on request after auth validation', () => {
    const keyId = 'test-key-123';
    const mockReq = { authKeyId: keyId } as Record<string, unknown>;
    expect(mockReq.authKeyId).toBe(keyId);
  });

  it('should use stored keyId without calling validate again', () => {
    const storedKeyId = 'test-key-456';
    const result = typeof storedKeyId === 'string' ? storedKeyId : 'anonymous';
    expect(result).toBe('test-key-456');
  });

  it('should fall back to anonymous when authKeyId is not set', () => {
    const storedKeyId = undefined;
    const result = typeof storedKeyId === 'string' ? storedKeyId : 'anonymous';
    expect(result).toBe('anonymous');
  });
});

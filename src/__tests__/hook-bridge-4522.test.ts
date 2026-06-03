/**
 * hook-bridge-4522.test.ts — Tests for Issue #4522 CC v2.1.152 hook bridge updates.
 *
 * AC #1: SessionStart return fields (reloadSkills, hookSpecificOutput.sessionTitle)
 * AC #2: MessageDisplay transform event (hookSpecificOutput.message, sanitization, visible:false rejection)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setStructuredLogSink } from '../logger.js';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import type { SessionManager, SessionInfo } from '../session.js';

setStructuredLogSink({ info: () => {}, warn: () => {}, error: () => {} });

function makeFakeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    windowId: 'test-window',
    displayName: 'Test Session',
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
  } as SessionInfo;
}

function makeFakeSessionManager(overrides: Partial<SessionManager> = {}): SessionManager {
  const session = makeFakeSession();
  return {
    getSession: vi.fn().mockReturnValue(session),
    addSubagent: vi.fn(),
    removeSubagent: vi.fn(),
    recordHookFailure: vi.fn().mockReturnValue(0),
    recordHookSuccess: vi.fn(),
    checkHookCircuitBreaker: vi.fn().mockReturnValue(false),
    updateSessionModel: vi.fn(),
    updateStatusFromHook: vi.fn().mockReturnValue('idle'),
    detectWaitingForInput: vi.fn().mockResolvedValue(false),
    emitHook: vi.fn(),
    ...overrides,
  } as unknown as SessionManager;
}

describe('AC #1: SessionStart return fields (Issue #4522)', () => {
  let app: FastifyInstance;
  let bus: SessionEventBus;
  let sessions: SessionManager;

  beforeEach(async () => {
    app = Fastify();
    bus = new SessionEventBus();
    sessions = makeFakeSessionManager();
    registerHookRoutes(app, { sessions, eventBus: bus });
    await app.ready();
  });

  it('rejects SessionStart without a session ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks/SessionStart',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns reloadSkills: true in SessionStart response (no title provided)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks/SessionStart?sessionId=00000000-0000-4000-8000-000000000001',
      payload: { hook_event_name: 'SessionStart' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.reloadSkills).toBe(true);
    expect((body.hookSpecificOutput as Record<string, unknown>).hookEventName).toBe('SessionStart');
  });

  it('includes sessionTitle in response and stores in session.metadata when provided', async () => {
    let storedSession: SessionInfo | undefined;
    const localSessions = makeFakeSessionManager({
      getSession: vi.fn().mockImplementation(() => {
        storedSession = makeFakeSession();
        return storedSession;
      }),
    });
    const localApp = Fastify();
    registerHookRoutes(localApp, { sessions: localSessions, eventBus: new SessionEventBus() });
    await localApp.ready();

    const res = await localApp.inject({
      method: 'POST',
      url: '/v1/hooks/SessionStart?sessionId=00000000-0000-4000-8000-000000000001',
      payload: { hook_event_name: 'SessionStart', sessionTitle: 'My Project Work' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.reloadSkills).toBe(true);
    expect((body.hookSpecificOutput as Record<string, unknown>).sessionTitle).toBe('My Project Work');
    // Title stored in metadata (no new field on SessionInfo)
    expect(storedSession?.metadata?.title).toBe('My Project Work');
  });
});

describe('AC #2: MessageDisplay transform event (Issue #4522)', () => {
  let app: FastifyInstance;
  let bus: SessionEventBus;
  let sessions: SessionManager;

  beforeEach(async () => {
    app = Fastify();
    bus = new SessionEventBus();
    sessions = makeFakeSessionManager();
    registerHookRoutes(app, { sessions, eventBus: bus });
    await app.ready();
  });

  it('accepts MessageDisplay as a known hook event (no 400 unknown)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks/MessageDisplay?sessionId=00000000-0000-4000-8000-000000000001',
      payload: { hook_event_name: 'MessageDisplay' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('sanitizes text in hookSpecificOutput.message and returns sanitized text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks/MessageDisplay?sessionId=00000000-0000-4000-8000-000000000001',
      payload: {
        hook_event_name: 'MessageDisplay',
        hookSpecificOutput: {
          hookEventName: 'MessageDisplay',
          message: {
            text: 'Hello <script>alert(1)</script> World\x00\x01',
            visible: true,
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const hso = body.hookSpecificOutput as Record<string, unknown>;
    const message = hso.message as Record<string, unknown>;
    expect(typeof message.text).toBe('string');
    // Script tag stripped
    expect(message.text as string).not.toContain('<script>');
    // Control chars stripped (0x00, 0x01)
    expect(message.text as string).not.toMatch(/[\x00-\x08]/);
    // 'Hello' and 'World' still present
    expect(message.text as string).toContain('Hello');
    expect(message.text as string).toContain('World');
    expect(message.visible).toBe(true);
  });

  // CodeQL #4522: prior sanitizer regex failed on script/style tag whitespace
  // variations (< script >, <script >, </script >, etc.) and on attribute forms.
  // These cases must all be stripped.
  it.each([
    ['< script>alert(1)</script>', 'whitespace before opening tag'],
    ['<script >alert(1)</script>', 'whitespace after opening tag'],
    ['</script >', 'whitespace after closing tag name'],
    ['<script\ttype="text/javascript">alert(1)</script>', 'tab + attributes'],
    ['<script\n>alert(1)</script>', 'newline in tag'],
    ['<STYLE>body{}</STYLE>', 'uppercase style tags'],
    ['<script src="http://evil/x.js"></script>', 'script with src attribute'],
    ['<iframe src="http://evil/"></iframe>', 'iframe tag'],
    ['javascript:alert(1)', 'javascript: URL'],
    ['onclick="alert(1)"', 'inline event handler'],
  ])('strips dangerous payload: %s (%s)', async (payload, _label) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks/MessageDisplay?sessionId=00000000-0000-4000-8000-000000000001',
      payload: {
        hook_event_name: 'MessageDisplay',
        hookSpecificOutput: {
          hookEventName: 'MessageDisplay',
          message: { text: `before ${payload} after`, visible: true },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const message = (body.hookSpecificOutput as Record<string, unknown>).message as Record<string, unknown>;
    const out = message.text as string;
    // Surrounding 'before' / 'after' preserved
    expect(out).toContain('before');
    expect(out).toContain('after');
    // No tag-like content survived
    expect(out).not.toMatch(/<\s*\/?\s*script/i);
    expect(out).not.toMatch(/<\s*\/?\s*style/i);
    expect(out).not.toMatch(/<\s*\/?\s*iframe/i);
    expect(out).not.toMatch(/javascript\s*:/i);
    expect(out).not.toMatch(/on[a-z]+\s*=/i);
  });

  it('rejects visible:false with a warning and no transform (Themis sign-off required)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks/MessageDisplay?sessionId=00000000-0000-4000-8000-000000000001',
      payload: {
        hook_event_name: 'MessageDisplay',
        hookSpecificOutput: {
          hookEventName: 'MessageDisplay',
          message: {
            text: 'should be ignored',
            visible: false,
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.warning).toContain('visible:false rejected');
    expect(JSON.stringify(body)).not.toContain('should be ignored');
  });
});

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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { stripProtoKeys } from '../hooks-cc-bridge-4522.js';
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

  it('sanitizes sessionTitle before storage (defense against stored XSS in metadata.title)', async () => {
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

    const maliciousTitle = '<script>alert(1)</script>Evil';
    const res = await localApp.inject({
      method: 'POST',
      url: '/v1/hooks/SessionStart?sessionId=00000000-0000-4000-8000-000000000001',
      payload: { hook_event_name: 'SessionStart', sessionTitle: maliciousTitle },
    });
    expect(res.statusCode).toBe(200);
    // The stored title is HTML-escaped (script tag rendered as text)
    const stored = storedSession?.metadata?.title as string;
    expect(stored).toBeDefined();
    expect(stored).not.toContain('<script>');
    expect(stored).toContain('&lt;script&gt;');
    expect(stored).toContain('Evil');
    // The response also returns the sanitized title
    const body = res.json() as Record<string, unknown>;
    const hso = body.hookSpecificOutput as Record<string, unknown>;
    expect(hso.sessionTitle as string).not.toContain('<script>');
    expect(hso.sessionTitle as string).toContain('&lt;script&gt;');
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

  it('sanitizes text in hookSpecificOutput.message: HTML-escapes payloads so tags render as text', async () => {
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
    // Script tag escaped (rendered as text, not interpreted as markup)
    expect(message.text as string).not.toContain('<script>');
    expect(message.text as string).toContain('&lt;script&gt;');
    // Control chars stripped (0x00, 0x01)
    expect(message.text as string).not.toMatch(/[\x00-\x08]/);
    // 'Hello' and 'World' still present (as visible text)
    expect(message.text as string).toContain('Hello');
    expect(message.text as string).toContain('World');
    expect(message.visible).toBe(true);
  });

  // CodeQL #4522: prior regex-based tag stripping was provably incomplete.
  // Switched to HTML-escape. The security model: payload is rendered as TEXT
  // (via the &lt; / &gt; / &quot; entities), so a safe text renderer (textContent,
  // JSX, etc.) cannot execute the payload. These tests confirm the output is
  // HTML-safe (no raw tag characters) and that benign text passes through.
  it.each([
    ['<script>alert(1)</script>', 'standard script tag'],
    ['< script>alert(1)</script>', 'whitespace before tag name'],
    ['<script >alert(1)</script>', 'whitespace after tag name'],
    ['</script >', 'whitespace after closing tag'],
    ['<script\ttype="text/javascript">alert(1)</script>', 'tab + attributes'],
    ['<script\n>alert(1)</script>', 'newline in tag'],
    ['<STYLE>body{}</STYLE>', 'uppercase style tags'],
    ['<script src="http://evil/x.js"></script>', 'script with src attribute'],
    ['<iframe src="http://evil/"></iframe>', 'iframe tag'],
    ['<img src=x onerror=alert(1)>', 'img with onerror handler'],
    ['<svg/onload=alert(1)>', 'svg with onload handler'],
    ['javascript:alert(1)', 'javascript: URL'],
    ['onclick="alert(1)"', 'inline event handler attribute'],
    ['<a href="javascript:alert(1)">click</a>', 'anchor with javascript: href'],
    ['&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;', 'HTML-entity-encoded script'],
  ])('renders dangerous payload as inert text: %s (%s)', async (payload, _label) => {
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
    // No raw tag characters survive in the output (any tags/attributes are escaped)
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    // javascript: URLs (with any whitespace) are stripped
    expect(out).not.toMatch(/javascript\s*:/i);
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

describe('Issue #4522 prototype pollution defense (stripProtoKeys helper)', () => {
  it('strips __proto__/constructor/prototype keys from the parsed ccBridge body', () => {
    // Standard __proto__ pollution attempt
    const polluted = JSON.parse('{"__proto__":{"isAdmin":true},"safe":"value"}');
    const cleaned = stripProtoKeys(polluted) as { safe?: string };
    expect(cleaned.safe).toBe('value');
    // The prototype is NOT polluted — a fresh object should not see isAdmin
    expect((cleaned as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();

    // constructor.prototype pollution
    const ctorPolluted = JSON.parse('{"constructor":{"prototype":{"polluted":true}},"safe":"v2"}');
    const cleaned2 = stripProtoKeys(ctorPolluted) as { safe?: string };
    expect(cleaned2.safe).toBe('v2');
    expect((cleaned2 as Record<string, unknown>).polluted).toBeUndefined();

    // Nested pollution (recursive)
    const nested = JSON.parse('{"outer":{"__proto__":{"x":1},"inner":{"safe":"y"}}}');
    const cleaned3 = stripProtoKeys(nested) as { outer: { inner: { safe?: string } } };
    expect(cleaned3.outer.inner.safe).toBe('y');

    // Arrays handled (each element stripped recursively)
    const arr = JSON.parse('[{"__proto__":{"x":1}},{"safe":"a"}]');
    const cleaned4 = stripProtoKeys(arr) as Array<{ safe?: string }>;
    expect(cleaned4[0].safe).toBeUndefined();
    expect(cleaned4[1].safe).toBe('a');

    // Non-objects pass through unchanged
    expect(stripProtoKeys(null)).toBe(null);
    expect(stripProtoKeys('string')).toBe('string');
    expect(stripProtoKeys(42)).toBe(42);
  });
});

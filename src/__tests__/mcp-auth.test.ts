/**
 * Unit tests for src/mcp/auth.ts
 *
 * Covers: formatToolError, withAuth RBAC wrapper, role level enforcement,
 * TOOL_REQUIRED_ROLE mapping, and edge cases.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  formatToolError,
  withAuth,
  TOOL_REQUIRED_ROLE,
} from '../mcp/auth.js';
import type { IAegisBackend } from '../services/interfaces.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makeBackend(role: string): IAegisBackend {
  return {
    resolveRole: vi.fn().mockResolvedValue(role),
  } as unknown as IAegisBackend;
}

function parseErrorContent(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
  expect(result.isError).toBe(true);
  expect(result.content).toHaveLength(1);
  expect(result.content[0]!.type).toBe('text');
  return JSON.parse(result.content[0]!.text);
}

// ── formatToolError ────────────────────────────────────────────────────

describe('formatToolError', () => {
  it('formats Error with SERVER_UNREACHABLE code', () => {
    const result = formatToolError(new Error('Server not running'));
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('SERVER_UNREACHABLE');
    expect(parsed.message).toBe('Server not running');
  });

  it('formats Error with SERVER_UNREACHABLE for "not reachable"', () => {
    const result = formatToolError(new Error('Server not reachable'));
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('SERVER_UNREACHABLE');
  });

  it('formats Error with SERVER_UNREACHABLE for "Network error"', () => {
    const result = formatToolError(new Error('Network error'));
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('SERVER_UNREACHABLE');
  });

  it('formats Error with INVALID_SESSION_ID code', () => {
    const result = formatToolError(new Error('Invalid session ID: xyz'));
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('INVALID_SESSION_ID');
  });

  it('formats Error with REQUEST_FAILED code for generic errors', () => {
    const result = formatToolError(new Error('Something went wrong'));
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('REQUEST_FAILED');
  });

  it('formats non-Error values with UNKNOWN_ERROR code', () => {
    const result = formatToolError('string error');
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('UNKNOWN_ERROR');
    expect(parsed.message).toBe('string error');
  });

  it('formats null with UNKNOWN_ERROR code', () => {
    const result = formatToolError(null);
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('UNKNOWN_ERROR');
    expect(parsed.message).toBe('null');
  });

  it('formats number with UNKNOWN_ERROR code', () => {
    const result = formatToolError(42);
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('UNKNOWN_ERROR');
    expect(parsed.message).toBe('42');
  });

  it('formats undefined with UNKNOWN_ERROR code', () => {
    const result = formatToolError(undefined);
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('UNKNOWN_ERROR');
    expect(parsed.message).toBe('undefined');
  });

  it('always returns isError: true', () => {
    expect(formatToolError(new Error('x')).isError).toBe(true);
    expect(formatToolError('x').isError).toBe(true);
    expect(formatToolError(null).isError).toBe(true);
  });
});

// ── TOOL_REQUIRED_ROLE mapping ─────────────────────────────────────────

describe('TOOL_REQUIRED_ROLE', () => {
  it('maps viewer tools correctly', () => {
    const viewerTools = ['list_sessions', 'get_status', 'get_transcript',
      'server_health', 'get_session_metrics', 'get_session_summary',
      'get_session_latency', 'list_pipelines', 'get_swarm', 'state_get'];
    for (const tool of viewerTools) {
      expect(TOOL_REQUIRED_ROLE[tool], `${tool} should be viewer`).toBe('viewer');
    }
  });

  it('maps operator tools correctly', () => {
    const operatorTools = ['send_message', 'create_session', 'approve_permission',
      'reject_permission', 'escape_session', 'interrupt_session', 'send_command',
      'batch_create_sessions', 'create_pipeline', 'state_set', 'state_delete'];
    for (const tool of operatorTools) {
      expect(TOOL_REQUIRED_ROLE[tool], `${tool} should be operator`).toBe('operator');
    }
  });

  it('maps admin tools correctly', () => {
    expect(TOOL_REQUIRED_ROLE['kill_session']).toBe('admin');
  });

  it('kill_session is the only admin tool', () => {
    const adminTools = Object.entries(TOOL_REQUIRED_ROLE)
      .filter(([, role]) => role === 'admin')
      .map(([name]) => name);
    expect(adminTools).toEqual(['kill_session']);
  });
});

// ── withAuth RBAC ───────────────────────────────────────────────────────

describe('withAuth', () => {
  it('allows viewer to call viewer tools', async () => {
    const backend = makeBackend('viewer');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('list_sessions', handler, backend);
    const result = await wrapped({});
    expect(handler).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
  });

  it('blocks viewer from operator tools', async () => {
    const backend = makeBackend('viewer');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('send_message', handler, backend);
    const result = await wrapped({});
    expect(handler).not.toHaveBeenCalled();
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('FORBIDDEN');
    expect(parsed.message).toContain('viewer');
    expect(parsed.message).toContain('operator');
  });

  it('blocks viewer from admin tools', async () => {
    const backend = makeBackend('viewer');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('kill_session', handler, backend);
    const result = await wrapped({});
    expect(handler).not.toHaveBeenCalled();
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('FORBIDDEN');
  });

  it('allows operator to call viewer tools', async () => {
    const backend = makeBackend('operator');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('list_sessions', handler, backend);
    await wrapped({});
    expect(handler).toHaveBeenCalledOnce();
  });

  it('allows operator to call operator tools', async () => {
    const backend = makeBackend('operator');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('create_session', handler, backend);
    await wrapped({});
    expect(handler).toHaveBeenCalledOnce();
  });

  it('blocks operator from admin tools', async () => {
    const backend = makeBackend('operator');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('kill_session', handler, backend);
    const result = await wrapped({});
    expect(handler).not.toHaveBeenCalled();
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('FORBIDDEN');
    expect(parsed.message).toContain('operator');
    expect(parsed.message).toContain('admin');
  });

  it('allows admin to call any tool', async () => {
    const backend = makeBackend('admin');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });

    // Viewer tool
    const wrapped1 = withAuth('list_sessions', handler, backend);
    await wrapped1({});

    // Operator tool
    const wrapped2 = withAuth('create_session', handler, backend);
    await wrapped2({});

    // Admin tool
    const wrapped3 = withAuth('kill_session', handler, backend);
    await wrapped3({});

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('allows unknown tool (no required role)', async () => {
    const backend = makeBackend('viewer');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('unknown_tool_xyz', handler, backend);
    await wrapped({});
    expect(handler).toHaveBeenCalledOnce();
  });

  it('blocks unknown role from operator tools', async () => {
    const backend = makeBackend('unknown_role');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('send_message', handler, backend);
    const result = await wrapped({});
    expect(handler).not.toHaveBeenCalled();
    const parsed = parseErrorContent(result);
    expect(parsed.code).toBe('FORBIDDEN');
  });

  it('passes args through to handler', async () => {
    const backend = makeBackend('admin');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('list_sessions', handler, backend);
    const args = { sessionId: 'abc-123', message: 'hello' };
    await wrapped(args);
    expect(handler).toHaveBeenCalledWith(args);
  });

  it('formats auth error with correct tool name and roles', async () => {
    const backend = makeBackend('viewer');
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'ok' }],
    });
    const wrapped = withAuth('kill_session', handler, backend);
    const result = await wrapped({});
    const parsed = parseErrorContent(result);
    expect(parsed.message).toContain('kill_session');
    expect(parsed.message).toContain('admin');
    expect(parsed.message).toContain('viewer');
  });
});

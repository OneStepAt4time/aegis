/**
 * acp-tools-coverage-3718.test.ts — Tests for mcp/tools/acp-tools.ts
 *
 * Covers all 13 ACP MCP tool handlers registered by registerAcpTools().
 * Uses a mock IAegisBackend to exercise success, error, and not-implemented paths.
 *
 * Issue: #3718 — target >70% line + branch coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAcpTools } from '../mcp/tools/acp-tools.js';
import type { IAegisBackend } from '../services/interfaces.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a mock IAegisBackend with all methods stubbed. */
function createMockClient(overrides: Partial<IAegisBackend> = {}): IAegisBackend {
  return {
    resolveRole: vi.fn().mockResolvedValue('operator'),
    sendMessage: vi.fn().mockResolvedValue({ ok: true, delivered: true }),
    approvePermission: vi.fn().mockResolvedValue({ ok: true }),
    rejectPermission: vi.fn().mockResolvedValue({ ok: true }),
    pauseSession: vi.fn().mockResolvedValue({ ok: true }),
    resumeSession: vi.fn().mockResolvedValue({ ok: true }),
    cancelSession: vi.fn().mockResolvedValue({ ok: true }),
    getEvents: vi.fn().mockResolvedValue([{ type: 'message', data: 'hello' }]),
    ...overrides,
  } as unknown as IAegisBackend;
}

/** Extract registered tool handlers from an McpServer instance. */
interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface RegisteredTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<ToolCallResult>;
}

function extractTools(client: IAegisBackend): RegisteredTool[] {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  registerAcpTools(server, client);

  // Access the internal tool map from the McpServer
  const tools: RegisteredTool[] = [];
  // @ts-expect-error — accessing private _registeredTools for testing
  const registered = server._registeredTools ?? server._tools;
  if (registered) {
    for (const [name, def] of Object.entries(registered as Record<string, { handler: (args: Record<string, unknown>) => Promise<ToolCallResult> }>)) {
      tools.push({ name, handler: def.handler });
    }
  }

  // Fallback: call server.tool() handlers by invoking the registered tools via the MCP protocol
  if (tools.length === 0) {
    // Use the fallback approach: create a new server and intercept tool registration
    const toolMap = new Map<string, (args: Record<string, unknown>) => Promise<ToolCallResult>>();

    // Patch the server.tool method to capture registrations
    const origTool = server.tool.bind(server);
    // The third/fourth arg pattern varies, so we wrap at a lower level
    // Instead, just create a fresh server with a patched tool method
    const server2 = new McpServer({ name: 'test2', version: '1.0.0' });

    // We need to intercept the actual server.tool() calls
    const captured: Array<{ name: string; handler: (args: any) => Promise<any> }> = [];
    const origFn = server2.tool;

    // McpServer.tool has overloads; we intercept by wrapping
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server2 as any).tool = function (name: string, ...rest: any[]) {
      captured.push({ name, handler: rest[rest.length - 1] });
      return (origFn as any).call(this, name, ...rest);
    };

    registerAcpTools(server2, client);
    for (const c of captured) {
      tools.push({ name: c.name, handler: c.handler });
    }
  }

  return tools;
}

function parseResult(result: ToolCallResult) {
  return JSON.parse(result.content[0]!.text);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('registerAcpTools', () => {
  let client: IAegisBackend;
  let tools: Map<string, RegisteredTool>;

  beforeEach(() => {
    client = createMockClient();
    const extracted = extractTools(client);
    tools = new Map(extracted.map(t => [t.name, t]));
  });

  // ── acp_send_prompt ──

  describe('acp_send_prompt', () => {
    it('sends a prompt and returns queued action', async () => {
      const tool = tools.get('acp_send_prompt')!;
      const result = await tool.handler({
        sessionId: 'session-1',
        prompt: 'Hello world',
      });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.actionType).toBe('prompt.send');
      expect(parsed.queued).toBe(true);
      expect(result.isError).toBeFalsy();
      expect(client.sendMessage).toHaveBeenCalledWith('session-1', 'Hello world');
    });

    it('returns error when sendMessage throws', async () => {
      client = createMockClient({
        sendMessage: vi.fn().mockRejectedValue(new Error('Session not running')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_send_prompt')!;
      const result = await tool.handler({ sessionId: 'bad-session', prompt: 'test' });
      expect(result.isError).toBe(true);
      const parsed = parseResult(result);
      expect(parsed.code).toBe('SERVER_UNREACHABLE');
    });
  });

  // ── acp_respond_approval ──

  describe('acp_respond_approval', () => {
    it('approves a permission request', async () => {
      const tool = tools.get('acp_respond_approval')!;
      const result = await tool.handler({
        sessionId: 'session-1',
        approved: true,
      });
      const parsed = parseResult(result);
      expect(parsed.approved).toBe(true);
      expect(parsed.actionType).toBe('approval.respond');
      expect(client.approvePermission).toHaveBeenCalledWith('session-1');
    });

    it('rejects a permission request with reason', async () => {
      const tool = tools.get('acp_respond_approval')!;
      const result = await tool.handler({
        sessionId: 'session-1',
        approved: false,
        reason: 'unsafe command',
      });
      const parsed = parseResult(result);
      expect(parsed.approved).toBe(false);
      expect(parsed.reason).toBe('unsafe command');
      expect(client.rejectPermission).toHaveBeenCalledWith('session-1');
    });

    it('handles error from approvePermission', async () => {
      client = createMockClient({
        approvePermission: vi.fn().mockRejectedValue(new Error('Invalid session ID: xyz')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_respond_approval')!;
      const result = await tool.handler({ sessionId: 'xyz', approved: true });
      expect(result.isError).toBe(true);
      const parsed = parseResult(result);
      expect(parsed.code).toBe('INVALID_SESSION_ID');
    });

    it('handles error from rejectPermission', async () => {
      client = createMockClient({
        rejectPermission: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_respond_approval')!;
      const result = await tool.handler({ sessionId: 'session-1', approved: false });
      expect(result.isError).toBe(true);
    });
  });

  // ── acp_pause_session ──

  describe('acp_pause_session', () => {
    it('pauses a session', async () => {
      const tool = tools.get('acp_pause_session')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.actionType).toBe('session.pause');
      expect(client.pauseSession).toHaveBeenCalledWith('session-1', undefined);
    });

    it('pauses a session with reason', async () => {
      const tool = tools.get('acp_pause_session')!;
      const result = await tool.handler({ sessionId: 'session-1', reason: 'maintenance' });
      const parsed = parseResult(result);
      expect(parsed.actionType).toBe('session.pause');
      expect(client.pauseSession).toHaveBeenCalledWith('session-1', 'maintenance');
    });

    it('handles error', async () => {
      client = createMockClient({
        pauseSession: vi.fn().mockRejectedValue(new Error('Session not reachable')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_pause_session')!;
      const result = await tool.handler({ sessionId: 'bad' });
      expect(result.isError).toBe(true);
    });
  });

  // ── acp_resume_session ──

  describe('acp_resume_session', () => {
    it('resumes a paused session', async () => {
      const tool = tools.get('acp_resume_session')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.actionType).toBe('session.resume');
      expect(client.resumeSession).toHaveBeenCalledWith('session-1');
    });

    it('handles error', async () => {
      client = createMockClient({
        resumeSession: vi.fn().mockRejectedValue(new Error('not running')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_resume_session')!;
      const result = await tool.handler({ sessionId: 'bad' });
      expect(result.isError).toBe(true);
    });
  });

  // ── acp_cancel_session ──

  describe('acp_cancel_session', () => {
    it('cancels a session gracefully', async () => {
      const tool = tools.get('acp_cancel_session')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.actionType).toBe('session.cancel');
      expect(parsed.force).toBe(false);
      expect(client.cancelSession).toHaveBeenCalledWith('session-1', undefined);
    });

    it('cancels a session with force', async () => {
      const tool = tools.get('acp_cancel_session')!;
      const result = await tool.handler({ sessionId: 'session-1', force: true });
      const parsed = parseResult(result);
      expect(parsed.force).toBe(true);
      expect(client.cancelSession).toHaveBeenCalledWith('session-1', true);
    });

    it('handles error', async () => {
      client = createMockClient({
        cancelSession: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_cancel_session')!;
      const result = await tool.handler({ sessionId: 'bad' });
      expect(result.isError).toBe(true);
    });
  });

  // ── acp_claim_driver (placeholder) ──

  describe('acp_claim_driver', () => {
    it('returns not_implemented', async () => {
      const tool = tools.get('acp_claim_driver')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.status).toBe('not_implemented');
      expect(parsed.actionType).toBe('driver.claim');
    });

    it('includes ttlSeconds when provided', async () => {
      const tool = tools.get('acp_claim_driver')!;
      const result = await tool.handler({ sessionId: 'session-1', ttlSeconds: 300 });
      const parsed = parseResult(result);
      expect(parsed.ttlSeconds).toBe(300);
    });
  });

  // ── acp_release_driver (placeholder) ──

  describe('acp_release_driver', () => {
    it('returns not_implemented', async () => {
      const tool = tools.get('acp_release_driver')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.status).toBe('not_implemented');
      expect(parsed.actionType).toBe('driver.release');
    });
  });

  // ── acp_transfer_driver (placeholder) ──

  describe('acp_transfer_driver', () => {
    it('returns not_implemented with targetKeyId', async () => {
      const tool = tools.get('acp_transfer_driver')!;
      const result = await tool.handler({ sessionId: 'session-1', targetKeyId: 'key-abc' });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.status).toBe('not_implemented');
      expect(parsed.actionType).toBe('driver.transfer');
      expect(parsed.targetKeyId).toBe('key-abc');
    });
  });

  // ── acp_get_events ──

  describe('acp_get_events', () => {
    it('retrieves events from session', async () => {
      const tool = tools.get('acp_get_events')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.actionType).toBe('events.get');
      expect(parsed.events).toHaveLength(1);
      expect(parsed.count).toBe(1);
      expect(client.getEvents).toHaveBeenCalledWith('session-1', undefined, undefined);
    });

    it('passes since and limit parameters', async () => {
      const tool = tools.get('acp_get_events')!;
      await tool.handler({ sessionId: 'session-1', since: 42, limit: 10 });
      expect(client.getEvents).toHaveBeenCalledWith('session-1', 42, 10);
    });

    it('handles error', async () => {
      client = createMockClient({
        getEvents: vi.fn().mockRejectedValue(new Error('Session not running')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_get_events')!;
      const result = await tool.handler({ sessionId: 'bad' });
      expect(result.isError).toBe(true);
    });
  });

  // ── acp_get_chat (placeholder) ──

  describe('acp_get_chat', () => {
    it('returns not_implemented', async () => {
      const tool = tools.get('acp_get_chat')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.status).toBe('not_implemented');
      expect(parsed.actionType).toBeUndefined();
    });

    it('includes offset and limit when provided', async () => {
      const tool = tools.get('acp_get_chat')!;
      const result = await tool.handler({ sessionId: 'session-1', offset: 10, limit: 25 });
      const parsed = parseResult(result);
      expect(parsed.offset).toBe(10);
      expect(parsed.limit).toBe(25);
    });

    it('uses default offset=0 and limit=50', async () => {
      const tool = tools.get('acp_get_chat')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.offset).toBe(0);
      expect(parsed.limit).toBe(50);
    });
  });

  // ── acp_get_timeline (placeholder) ──

  describe('acp_get_timeline', () => {
    it('returns not_implemented', async () => {
      const tool = tools.get('acp_get_timeline')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.status).toBe('not_implemented');
    });

    it('includes offset and limit', async () => {
      const tool = tools.get('acp_get_timeline')!;
      const result = await tool.handler({ sessionId: 'session-1', offset: 5, limit: 20 });
      const parsed = parseResult(result);
      expect(parsed.offset).toBe(5);
      expect(parsed.limit).toBe(20);
    });
  });

  // ── acp_get_terminal_debug (placeholder) ──

  describe('acp_get_terminal_debug', () => {
    it('returns not_implemented', async () => {
      const tool = tools.get('acp_get_terminal_debug')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.status).toBe('not_implemented');
      expect(parsed.sessionId).toBe('session-1');
    });

    it('includes maxLines', async () => {
      const tool = tools.get('acp_get_terminal_debug')!;
      const result = await tool.handler({ sessionId: 'session-1', maxLines: 100 });
      const parsed = parseResult(result);
      expect(parsed.maxLines).toBe(100);
    });

    it('defaults maxLines to -1', async () => {
      const tool = tools.get('acp_get_terminal_debug')!;
      const result = await tool.handler({ sessionId: 'session-1' });
      const parsed = parseResult(result);
      expect(parsed.maxLines).toBe(-1);
    });
  });

  // ── Error handling edge cases ──

  describe('error handling', () => {
    it('handles non-Error thrown values', async () => {
      client = createMockClient({
        sendMessage: vi.fn().mockRejectedValue('string error'),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_send_prompt')!;
      const result = await tool.handler({ sessionId: 's1', prompt: 'test' });
      expect(result.isError).toBe(true);
      const parsed = parseResult(result);
      expect(parsed.code).toBe('UNKNOWN_ERROR');
      expect(parsed.message).toBe('string error');
    });

    it('handles generic Error without known code', async () => {
      client = createMockClient({
        sendMessage: vi.fn().mockRejectedValue(new Error('something unexpected')),
      });
      const extracted = extractTools(client);
      const tool = extracted.find(t => t.name === 'acp_send_prompt')!;
      const result = await tool.handler({ sessionId: 's1', prompt: 'test' });
      expect(result.isError).toBe(true);
      const parsed = parseResult(result);
      expect(parsed.code).toBe('REQUEST_FAILED');
    });
  });
});

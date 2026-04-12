/**
 * mcp/auth.ts — MCP tool authorization (RBAC) and error formatting.
 *
 * Provides withAuth() wrapper for per-tool role enforcement,
 * role mapping, and structured MCP error envelopes.
 */

import type { IAegisBackend } from '../services/interfaces.js';

// ── Error handling ──────────────────────────────────────────────────

interface McpErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

export function formatToolError(e: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  if (e instanceof Error) {
    let code: string;
    if (e.message.includes('not running') || e.message.includes('not reachable') || e.message.includes('Network error')) {
      code = 'SERVER_UNREACHABLE';
    } else if (e.message.startsWith('Invalid session ID')) {
      code = 'INVALID_SESSION_ID';
    } else {
      code = 'REQUEST_FAILED';
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ code, message: e.message } satisfies McpErrorEnvelope) }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ code: 'UNKNOWN_ERROR', message: String(e) } satisfies McpErrorEnvelope) }],
    isError: true,
  };
}

// ── MCP Tool Authorization (Issue #1407) ──────────────────────────────

/** Minimum RBAC role required to call each MCP tool. */
export const TOOL_REQUIRED_ROLE: Record<string, string> = {
  // viewer — read-only, no side effects
  list_sessions: 'viewer',
  get_status: 'viewer',
  get_transcript: 'viewer',
  server_health: 'viewer',
  capture_pane: 'viewer',
  get_session_metrics: 'viewer',
  get_session_summary: 'viewer',
  get_session_latency: 'viewer',
  list_pipelines: 'viewer',
  get_swarm: 'viewer',
  state_get: 'viewer',
  // operator — interactive but non-destructive
  send_message: 'operator',
  create_session: 'operator',
  approve_permission: 'operator',
  reject_permission: 'operator',
  escape_session: 'operator',
  interrupt_session: 'operator',
  send_command: 'operator',
  batch_create_sessions: 'operator',
  create_pipeline: 'operator',
  state_set: 'operator',
  state_delete: 'operator',
  // admin — destructive, requires elevated access
  kill_session: 'admin',
  send_bash: 'admin',
};

/** Numeric role levels for comparison. */
const ROLE_LEVEL: Record<string, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

function formatAuthError(toolName: string, role: string, required: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ code: 'FORBIDDEN', message: `Tool '${toolName}' requires '${required}' role, but token has '${role}' role` } satisfies McpErrorEnvelope) }],
    isError: true,
  };
}

/** Wrap a tool handler with per-tool role authorization. */
export function withAuth<TArgs>(
  toolName: string,
  handler: (args: TArgs) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
  client: IAegisBackend,
): (args: TArgs) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return async (args) => {
    const role = await client.resolveRole();
    const required = TOOL_REQUIRED_ROLE[toolName];
    if (required && (ROLE_LEVEL[role] ?? 0) < (ROLE_LEVEL[required] ?? 0)) {
      return formatAuthError(toolName, role, required);
    }
    return handler(args);
  };
}

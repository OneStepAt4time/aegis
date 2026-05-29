/**
 * mcp/auth.ts — MCP tool authorization (RBAC), CC session tracking, and error formatting.
 *
 * Provides withAuth() wrapper for per-tool role enforcement,
 * CC session ID correlation (#4455), role mapping, and structured MCP error envelopes.
 */

import type { IAegisBackend } from '../services/interfaces.js';
import { ccSessionRegistry, getCcSessionIdFromEnv } from '../services/cc-session-registry.js';

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
  acp_send_prompt: 'operator',
  acp_respond_approval: 'operator',
  acp_pause_session: 'operator',
  acp_resume_session: 'operator',
  acp_cancel_session: 'operator',
  acp_claim_driver: 'operator',
  acp_release_driver: 'operator',
  acp_transfer_driver: 'operator',
  acp_get_events: 'viewer',
  acp_get_chat: 'viewer',
  acp_get_timeline: 'viewer',
  acp_get_terminal_debug: 'viewer',
  // admin — destructive, requires elevated access
  kill_session: 'admin',
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

/**
 * Record CC↔Aegis session mapping if CLAUDE_CODE_SESSION_ID is present.
 * Issue #4455: CC v2.1.154 passes this env var to MCP subprocesses.
 */
function recordCcSessionMapping(args: Record<string, unknown>): void {
  const ccSessionId = getCcSessionIdFromEnv();
  if (!ccSessionId) return;

  // Most session-scoped tools pass sessionId directly
  const aegisSessionId = args.sessionId as string | undefined;
  if (aegisSessionId && typeof aegisSessionId === 'string' && aegisSessionId.length > 0) {
    ccSessionRegistry.record(ccSessionId, aegisSessionId);
  }
}

/** Wrap a tool handler with per-tool role authorization and CC session tracking. */
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

    // #4455: Record CC session ID correlation when available
    recordCcSessionMapping(args as Record<string, unknown>);

    return handler(args);
  };
}

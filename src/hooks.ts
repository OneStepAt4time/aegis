/**
 * hooks.ts — HTTP hook receiver for Claude Code hook events.
 *
 * Claude Code supports type: "http" hooks that POST JSON events to a URL.
 * This module provides a route handler that receives these events and
 * forwards them to SSE subscribers.
 *
 * Hook URL pattern: POST /v1/hooks/{eventName}?sessionId={id}
 * Session identification: X-Session-Id header or sessionId query param.
 *
 * Decision events (PreToolUse, PermissionRequest) return a response body
 * that CC uses to approve/reject tool calls.
 *
 * Issue #169: Phase 1 — HTTP hooks infrastructure.
 * Issue #169: Phase 3 — Hook-driven status detection.
 */

import type { FastifyInstance } from 'fastify';
import type { SessionManager } from './session.js';
import type { SessionEventBus } from './events.js';
import type { UIState } from './terminal-parser.js';

/** CC hook events that require a decision response. */
const DECISION_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

/** Valid CC hook event names (allow any for extensibility, but these are known). */
const KNOWN_HOOK_EVENTS = new Set([
  'Stop',
  'StopFailure',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'SessionStart',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'TaskCompleted',
  'TeammateIdle',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
]);

/** Map hook event names to the UIState they imply. */
function hookToUIState(eventName: string): UIState | null {
  switch (eventName) {
    case 'Stop':
    case 'TaskCompleted':
    case 'SessionEnd': return 'idle';
    case 'StopFailure':
    case 'PostToolUseFailure': return 'error';
    case 'PreToolUse':
    case 'PostToolUse':
    case 'SubagentStart':
    case 'UserPromptSubmit': return 'working';
    case 'PermissionRequest': return 'ask_question';
    case 'TeammateIdle': return 'idle';
    default: return null;
  }
}

export interface HookRouteDeps {
  sessions: SessionManager;
  eventBus: SessionEventBus;
}

/**
 * Register the hooks endpoint on the Fastify app.
 *
 * This MUST be called before auth middleware is set up, OR the /v1/hooks
 * path must be added to the auth skip list in setupAuth().
 */
export function registerHookRoutes(app: FastifyInstance, deps: HookRouteDeps): void {
  app.post<{
    Params: { eventName: string };
    Querystring: { sessionId?: string };
  }>('/v1/hooks/:eventName', async (req, reply) => {
    const { eventName } = req.params;
    const sessionId = (req.headers['x-session-id'] as string) || req.query.sessionId;

    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing session ID — provide X-Session-Id header or sessionId query param' });
    }

    const session = deps.sessions.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({ error: `Session ${sessionId} not found` });
    }

    // Forward the raw hook event to SSE subscribers
    deps.eventBus.emitHook(sessionId, eventName, req.body as Record<string, unknown>);

    // Issue #169 Phase 3: Update session status from hook event
    const prevStatus = deps.sessions.updateStatusFromHook(sessionId, eventName);
    const newStatus = hookToUIState(eventName);

    // Emit SSE status event only when the hook implies a state change
    if (newStatus && prevStatus !== newStatus) {
      switch (eventName) {
        case 'Stop':
          deps.eventBus.emitStatus(sessionId, 'idle', 'Claude finished (hook: Stop)');
          break;
        case 'PreToolUse':
        case 'PostToolUse':
          deps.eventBus.emitStatus(sessionId, 'working', 'Claude is working (hook: tool use)');
          break;
        case 'PermissionRequest':
          deps.eventBus.emitApproval(sessionId,
            (req.body as Record<string, unknown>)?.permission_prompt as string
            || 'Permission requested (hook)');
          break;
      }
    }

    // Decision events need a response body that CC uses
    // Format: { hookSpecificOutput: { hookEventName, permissionDecision, reason? } }
    if (DECISION_EVENTS.has(eventName)) {
      const hookBody = req.body as Record<string, unknown>;
      const toolName = (hookBody?.tool_name as string) || '';
      const permissionPrompt = (hookBody?.permission_prompt as string) || '';

      // For PreToolUse: check tool name
      // For PermissionRequest: check prompt content
      // Default: allow (existing bypassPermissions behavior preserved)
      const decision = 'allow';

      if (eventName === 'PreToolUse') {
        return reply.status(200).send({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: decision,
          },
        });
      }

      if (eventName === 'PermissionRequest') {
        return reply.status(200).send({
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            permissionDecision: decision,
          },
        });
      }

      return reply.status(200).send({ ok: true });
    }

    // Non-decision events: simple acknowledgement
    return reply.status(200).send({ ok: true });
  });
}

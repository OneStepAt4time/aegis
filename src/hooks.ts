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
 */

import type { FastifyInstance } from 'fastify';
import type { SessionManager } from './session.js';
import type { SessionEventBus } from './events.js';

/** CC hook events that require a decision response. */
const DECISION_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

/** Valid CC hook event names (allow any for extensibility, but these are known). */
const KNOWN_HOOK_EVENTS = new Set([
  'Stop',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'PermissionRequest',
  'SessionStart',
  'SubagentStop',
]);

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

    // Forward the hook event to SSE subscribers
    deps.eventBus.emitHook(sessionId, eventName, req.body as Record<string, unknown>);

    // Decision events need a response body that CC uses
    if (DECISION_EVENTS.has(eventName)) {
      return reply.status(200).send({ decision: 'allow' });
    }

    // Non-decision events: simple acknowledgement
    return reply.status(200).send({ ok: true });
  });
}

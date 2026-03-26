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
import type { SessionManager, PermissionDecision } from './session.js';
import type { SessionEventBus } from './events.js';
import type { MetricsCollector } from './metrics.js';
import type { UIState } from './terminal-parser.js';

/** CC hook events that require a decision response. */
const DECISION_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

/** Permission modes that should be auto-approved via hook response. */
const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'plan', 'auto']);

/** Default timeout for waiting on client permission decision (ms). */
const PERMISSION_TIMEOUT_MS = 10_000;

/** Valid permission_mode values accepted by Claude Code. */
const VALID_PERMISSION_MODES = new Set(['default', 'plan', 'bypassPermissions']);

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
  'WorktreeCreate',
  'WorktreeCreateFailed',
  'WorktreeRemove',
  'WorktreeRemoveFailed',
  'Elicitation',
  'ElicitationResult',
  'FileChanged',
  'CwdChanged',
]);

/** Hook events that are informational (logged + forwarded to SSE, no status change). */
const INFORMATIONAL_EVENTS = new Set([
  'Notification',
  'FileChanged',
  'CwdChanged',
]);

/** Map hook event names to the UIState they imply. */
function hookToUIState(eventName: string): UIState | null {
  switch (eventName) {
    case 'Stop':
    case 'TaskCompleted':
    case 'SessionEnd':
    case 'PostCompact': return 'idle';
    case 'StopFailure':
    case 'PostToolUseFailure': return 'error';
    case 'PreToolUse':
    case 'PostToolUse':
    case 'SubagentStart':
    case 'UserPromptSubmit':
    case 'Elicitation':
    case 'ElicitationResult': return 'working';
    case 'PreCompact': return 'compacting';
    case 'PermissionRequest': return 'ask_question';
    case 'TeammateIdle': return 'idle';
    default: return null;
  }
}

export interface HookRouteDeps {
  sessions: SessionManager;
  eventBus: SessionEventBus;
  metrics?: MetricsCollector;
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

    // Issue #88: Track active subagents
    const hookBody = req.body as Record<string, unknown>;
    if (eventName === 'SubagentStart') {
      const agentName = (hookBody?.agent_name as string) || ((hookBody?.tool_input as Record<string, unknown>)?.command as string) || 'unknown';
      deps.sessions.addSubagent(sessionId, agentName);
      deps.eventBus.emit(sessionId, {
        event: 'subagent_start',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { agentName },
      });
    } else if (eventName === 'SubagentStop') {
      const agentName = (hookBody?.agent_name as string) || 'unknown';
      deps.sessions.removeSubagent(sessionId, agentName);
      deps.eventBus.emit(sessionId, {
        event: 'subagent_stop',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { agentName },
      });
    }

    // Issue #89 L26: WorktreeCreate/Remove hooks — informational tracking only
    if (eventName === 'WorktreeCreate' || eventName === 'WorktreeCreateFailed' ||
        eventName === 'WorktreeRemove' || eventName === 'WorktreeRemoveFailed') {
      console.log(`Hooks: ${eventName} for session ${sessionId}`);
    }

    // Informational events — log and forward to SSE (already forwarded below via emitHook)
    if (INFORMATIONAL_EVENTS.has(eventName)) {
      console.log(`Hooks: ${eventName} for session ${sessionId}`);
    }

    // PreCompact/PostCompact — update activity timestamp
    if (eventName === 'PreCompact' || eventName === 'PostCompact') {
      session.lastActivity = Date.now();
    }

    // Forward the raw hook event to SSE subscribers
    deps.eventBus.emitHook(sessionId, eventName, req.body as Record<string, unknown>);

    // Issue #89 L25: Capture model field from hook payload for dashboard display
    const hookPayload = req.body as Record<string, unknown>;
    if (hookPayload?.model && typeof hookPayload.model === 'string') {
      deps.sessions.updateSessionModel(sessionId, hookPayload.model as string);
    }

    // Issue #89 L24: Validate permission_mode from PermissionRequest hook
    if (eventName === 'PermissionRequest') {
      const rawMode = hookBody?.permission_mode as string | undefined;
      if (rawMode !== undefined && !VALID_PERMISSION_MODES.has(rawMode)) {
        console.warn(`Hooks: invalid permission_mode "${rawMode}" from PermissionRequest, using "default"`);
        hookBody.permission_mode = 'default';
      }
    }

    // Issue #169 Phase 3: Update session status from hook event
    // Issue #87: Extract timestamp from hook payload for latency calculation
    const hookReceivedAt = Date.now();
    const hookEventTimestamp = hookPayload?.timestamp
      ? new Date(hookPayload.timestamp as string).getTime()
      : undefined;

    // Issue #87: Record hook latency if we have a timestamp from the payload
    if (hookEventTimestamp && deps.metrics) {
      const latency = hookReceivedAt - hookEventTimestamp;
      if (latency >= 0) {
        deps.metrics.recordHookLatency(sessionId, latency);
      }
    }

    const prevStatus = deps.sessions.updateStatusFromHook(sessionId, eventName, hookEventTimestamp);
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
        case 'PreCompact':
          deps.eventBus.emitStatus(sessionId, 'compacting', 'Claude is compacting context (hook: PreCompact)');
          break;
        case 'PostCompact':
          deps.eventBus.emitStatus(sessionId, 'idle', 'Compaction complete (hook: PostCompact)');
          break;
        case 'Elicitation':
          deps.eventBus.emitStatus(sessionId, 'working', 'Claude is performing MCP elicitation (hook: Elicitation)');
          break;
        case 'ElicitationResult':
          deps.eventBus.emitStatus(sessionId, 'working', 'Elicitation result received (hook: ElicitationResult)');
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

      if (eventName === 'PreToolUse') {
        // PreToolUse: always allow (existing behavior)
        return reply.status(200).send({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
          },
        });
      }

      if (eventName === 'PermissionRequest') {
        // Issue #284: Hook-based permission approval.
        // Auto-approve modes respond immediately; others wait for client.
        const permMode = session.permissionMode || 'default';
        if (AUTO_APPROVE_MODES.has(permMode)) {
          console.log(`Hooks: auto-approving PermissionRequest for session ${sessionId} (mode: ${permMode})`);
          return reply.status(200).send({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              permissionDecision: 'allow',
            },
          });
        }

        // Non-auto-approve: wait for client to approve/reject via API.
        // Store pending permission and block until resolved or timeout.
        console.log(`Hooks: waiting for client permission decision for session ${sessionId}`);
        const decision: PermissionDecision = await deps.sessions.waitForPermissionDecision(
          sessionId,
          PERMISSION_TIMEOUT_MS,
          toolName,
          permissionPrompt,
        );

        const decisionLabel = decision === 'allow' ? 'approved' : 'rejected';
        console.log(`Hooks: PermissionRequest for session ${sessionId} — ${decisionLabel} by client`);

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

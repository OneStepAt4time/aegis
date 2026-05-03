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
import { isValidUUID, hookBodySchema, parseIntSafe } from './validation.js';
import type { MetricsCollector } from './metrics.js';
import type { UIState } from './terminal-parser.js';
import { evaluatePermissionProfile } from './services/permission/index.js';
import crypto from 'node:crypto';

/** CC hook events that require a decision response. */

/** Timing-safe string comparison to prevent timing attacks on secret values. */
function timingSafeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

const DECISION_EVENTS = new Set(['PreToolUse', 'PermissionRequest']);

/** Permission modes that should be auto-approved via hook response. */
const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'auto']);

/** Default timeout for waiting on client permission decision (ms). */
const PERMISSION_TIMEOUT_MS = 10_000;

const ANSWER_TIMEOUT_MIN_MS = 1_000;
const ANSWER_TIMEOUT_MAX_MS = 600_000;

function getAnswerTimeoutMs(): number {
  const value = parseIntSafe(process.env.ANSWER_TIMEOUT_MS, 30_000);
  if (value < ANSWER_TIMEOUT_MIN_MS) return ANSWER_TIMEOUT_MIN_MS;
  if (value > ANSWER_TIMEOUT_MAX_MS) return ANSWER_TIMEOUT_MAX_MS;
  return value;
}

/** Default timeout for waiting on external answer to AskUserQuestion (ms). */
const ANSWER_TIMEOUT_MS = getAnswerTimeoutMs();

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
  'WorktreeRemove',
  'Elicitation',
  'ElicitationResult',
  'FileChanged',
  'CwdChanged',
  // Issue #703 Phase 1: additional lifecycle events
  'PermissionDenied',
  'TaskCreated',
  'Setup',
  'ConfigChange',
  'InstructionsLoaded',
]);

/** Hook events that are informational (logged + forwarded to SSE, no status change). */
const INFORMATIONAL_EVENTS = new Set([
  'Notification',
  'FileChanged',
  'CwdChanged',
  // Issue #703 Phase 1: informational lifecycle events
  'Setup',
  'ConfigChange',
  'InstructionsLoaded',
  'PermissionDenied',
]);

/**
 * Deduplicate consecutive identical non-blank lines in a string.
 * Returns the deduplicated string, or null if no changes were needed.
 *
 * Issue #1799: Workaround for anthropics/claude-code#32891 —
 * the CC model sometimes generates Edit tool calls with consecutive
 * duplicate lines in new_string.
 */
function deduplicateConsecutiveLines(text: string): string | null {
  const lines = text.split('\n');
  const result: string[] = [];
  let changed = false;

  for (const line of lines) {
    if (line.trim() !== '' && result.length > 0 && result[result.length - 1] === line) {
      changed = true;
      continue; // skip consecutive duplicate
    }
    result.push(line);
  }

  return changed ? result.join('\n') : null;
}

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
    case 'ElicitationResult':
    case 'WorktreeCreate':
    case 'WorktreeRemove': return 'working';
    case 'PreCompact': return 'compacting';
    case 'PermissionRequest': return 'permission_prompt';
    case 'TeammateIdle': return 'idle';
    // Issue #703 Phase 1
    case 'TaskCreated': return 'working';
    default: return null;
  }
}

/** Extract question text from AskUserQuestion tool_input. */
function extractQuestionText(toolInput: Record<string, unknown> | undefined): string {
  if (!toolInput) return '';
  const questions = toolInput.questions as Array<Record<string, unknown>> | undefined;
  if (!questions || !Array.isArray(questions) || questions.length === 0) return '';
  const first = questions[0];
  return (first?.question as string) || '';
}

export interface HookRouteDeps {
  sessions: SessionManager;
  eventBus: SessionEventBus;
  metrics?: MetricsCollector;
  hookSecretHeaderOnly?: boolean;
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
    Querystring: { sessionId?: string; secret?: string };
  }>('/v1/hooks/:eventName', async (req, reply) => {
    const { eventName } = req.params;
    // Issue #349: Validate event name against known list to prevent injection
    if (!KNOWN_HOOK_EVENTS.has(eventName)) {
      return reply.status(400).send({ error: `Unknown hook event: ${eventName}` });
    }
    const sessionId = (req.headers['x-session-id'] as string) || req.query.sessionId;

    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing session ID — provide X-Session-Id header or sessionId query param' });
    }
    // Issue #580: Reject non-UUID session IDs before getSession lookup.
    if (!isValidUUID(sessionId)) {
      return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
    }

    const session = deps.sessions.getSession(sessionId);
    if (!session) {
      return reply.status(404).send({ error: `Session ${sessionId} not found` });
    }

    const headerHookSecret = req.headers['x-hook-secret'] as string | undefined;
    const queryHookSecret = req.query.secret;
    const hasQueryHookSecret = queryHookSecret !== undefined;
    if (deps.hookSecretHeaderOnly && hasQueryHookSecret) {
      return reply.status(401).send({ error: 'Unauthorized — hook secret must be sent via X-Hook-Secret header' });
    }
    if (!deps.hookSecretHeaderOnly && hasQueryHookSecret) {
      console.warn(`Hooks: query-string hook secret is deprecated (session ${sessionId}, event ${eventName}); use X-Hook-Secret header`);
    }
    const hookSecret = headerHookSecret || queryHookSecret;
    if (session.hookSecret && !timingSafeEqual(hookSecret, session.hookSecret)) {
      return reply.status(401).send({ error: 'Unauthorized — invalid hook secret' });
    }

    // Issue #665: Validate hook body with Zod instead of unsafe casts
    const parseResult = hookBodySchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({ error: `Invalid hook body: ${parseResult.error.message}` });
    }
    const hookBody = parseResult.data;

    // Issue #88: Track active subagents
    if (eventName === 'SubagentStart') {
      const agentName = hookBody.agent_name || hookBody.tool_input?.command || 'unknown';
      deps.sessions.addSubagent(sessionId, agentName);
      deps.eventBus.emit(sessionId, {
        event: 'subagent_start',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { agentName },
      });
    } else if (eventName === 'SubagentStop') {
      const agentName = hookBody.agent_name || 'unknown';
      deps.sessions.removeSubagent(sessionId, agentName);
      deps.eventBus.emit(sessionId, {
        event: 'subagent_stop',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { agentName },
      });
    }

    // Issue #703 Phase 1: PermissionDenied — emit denied event for dashboard/agents
    if (eventName === 'PermissionDenied') {
      deps.eventBus.emit(sessionId, {
        event: 'permission_denied',
        sessionId,
        timestamp: new Date().toISOString(),
        data: {
          toolName: hookBody.tool_name || '',
          reason: hookBody.reason || '',
        },
      });
    }

    // Issue #89 L26: WorktreeCreate/Remove hooks — informational tracking only
    if (eventName === 'WorktreeCreate' || eventName === 'WorktreeRemove') {
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

    // Issue #2519: Warn if hook payload exceeds 1.5KB — CC truncates SessionStart output >2KB
    const HOOK_PAYLOAD_WARN_BYTES = 1536;
    const payloadSize = JSON.stringify(req.body ?? {}).length;
    if (payloadSize > HOOK_PAYLOAD_WARN_BYTES) {
      console.warn(`Hooks: ${eventName} payload for session ${sessionId.slice(0, 8)} is ${payloadSize} bytes (${(payloadSize / 1024).toFixed(1)} KB) — exceeds ${HOOK_PAYLOAD_WARN_BYTES} byte warning threshold. CC may truncate SessionStart content >2KB (upstream #55750).`);
      deps.eventBus.emit(sessionId, {
        event: 'system',
        sessionId,
        timestamp: new Date().toISOString(),
        data: { level: 'warn', message: `Hook payload size ${payloadSize} bytes exceeds ${HOOK_PAYLOAD_WARN_BYTES} byte threshold. CC may truncate content.` },
      });
    }
    // Forward the validated hook event to SSE subscribers
    deps.eventBus.emitHook(sessionId, eventName, hookBody);

    // Issue #89 L25: Capture model field from hook payload for dashboard display
    if (hookBody.model) {
      deps.sessions.updateSessionModel(sessionId, hookBody.model);
    }

    // Issue #89 L24: Validate permission_mode from PermissionRequest hook
    if (eventName === 'PermissionRequest') {
      const rawMode = hookBody.permission_mode;
      if (rawMode !== undefined && !VALID_PERMISSION_MODES.has(rawMode)) {
        console.warn(`Hooks: invalid permission_mode "${rawMode}" from PermissionRequest, using "default"`);
        hookBody.permission_mode = 'default';
      }
    }

    // Issue #169 Phase 3: Update session status from hook event
    // Issue #87: Extract timestamp from hook payload for latency calculation
    const hookReceivedAt = Date.now();
    const hookEventTimestamp = hookBody.timestamp
      ? new Date(hookBody.timestamp).getTime()
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
        case 'Stop': {
          // Issue #812: Check if CC is waiting for user input (text-only last assistant message)
          const waiting = await deps.sessions.detectWaitingForInput(sessionId);
          if (waiting) {
            const session = deps.sessions.getSession(sessionId);
            if (session) session.status = 'waiting_for_input';
            deps.eventBus.emitStatus(sessionId, 'waiting_for_input', 'Claude finished, waiting for input (hook: Stop)');
          } else {
            deps.eventBus.emitStatus(sessionId, 'idle', 'Claude finished (hook: Stop)');
          }
          break;
        }
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
        case 'WorktreeCreate':
          deps.eventBus.emitStatus(sessionId, 'working', `Worktree created: ${hookBody.worktree_path || 'unknown'} (hook: WorktreeCreate)`);
          break;
        case 'WorktreeRemove':
          deps.eventBus.emitStatus(sessionId, 'idle', `Worktree removed: ${hookBody.worktree_path || 'unknown'} (hook: WorktreeRemove)`);
          break;
        case 'PermissionRequest':
          deps.eventBus.emitApproval(sessionId,
            hookBody.permission_prompt || 'Permission requested (hook)');
          break;
      }
    }

    // Decision events need a response body that CC uses
    // Format: { hookSpecificOutput: { hookEventName, permissionDecision, reason? } }
    if (DECISION_EVENTS.has(eventName)) {
      const toolName = hookBody.tool_name || '';
      const permissionPrompt = hookBody.permission_prompt || '';

      if (eventName === 'PreToolUse') {
        // Issue #336: Intercept AskUserQuestion for headless question answering
        if (toolName === 'AskUserQuestion') {
          const toolInput = hookBody.tool_input;
          const toolUseId = hookBody.tool_use_id || '';
          const questionText = extractQuestionText(toolInput);

          // Emit ask_question SSE event for external clients
          deps.eventBus.emit(sessionId, {
            event: 'status',
            sessionId,
            timestamp: new Date().toISOString(),
            data: { status: 'ask_question', questionId: toolUseId, question: questionText },
          });

          console.log(`Hooks: AskUserQuestion for session ${sessionId} — waiting for answer (timeout: ${ANSWER_TIMEOUT_MS}ms)`);

          const answer = await deps.sessions.waitForAnswer(sessionId, toolUseId, questionText, ANSWER_TIMEOUT_MS);

          if (answer !== null) {
            console.log(`Hooks: AskUserQuestion answered for session ${sessionId}`);
            return reply.status(200).send({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput: { answer },
              },
            });
          }

          // Timeout: allow without answer (CC shows question to user in terminal)
          console.log(`Hooks: AskUserQuestion timeout for session ${sessionId} — allowing without answer`);
        }

        if (session.permissionProfile) {
          const evaluation = evaluatePermissionProfile(session.permissionProfile, {
            toolName,
            toolInput: hookBody.tool_input,
          });

          if (evaluation.behavior === 'deny') {
            deps.eventBus.emit(sessionId, {
              event: 'permission_denied',
              sessionId,
              timestamp: new Date().toISOString(),
              data: { toolName, reason: evaluation.reason },
            });
            return reply.status(200).send({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                reason: evaluation.reason,
              },
            });
          }

          if (evaluation.behavior === 'ask') {
            deps.eventBus.emitApproval(sessionId, `Permission profile requires approval for ${toolName}`);
            const decision: PermissionDecision = await deps.sessions.waitForPermissionDecision(
              sessionId,
              PERMISSION_TIMEOUT_MS,
              toolName,
              evaluation.reason,
            );
            return reply.status(200).send({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: decision,
              },
            });
          }
        }

        // Issue #1799: Deduplicate consecutive lines in Edit tool's new_string.
        // Workaround for anthropics/claude-code#32891 — model generates
        // consecutive duplicate lines in Edit new_string.
        if (toolName === 'Edit' && hookBody.tool_input?.new_string) {
          const deduplicated = deduplicateConsecutiveLines(hookBody.tool_input.new_string as string);
          if (deduplicated !== null) {
            console.log(`Hooks: deduplicated Edit new_string for session ${sessionId} (CC bug #32891 workaround)`);
            return reply.status(200).send({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput: {
                  ...hookBody.tool_input,
                  new_string: deduplicated,
                },
              },
            });
          }
        }

        // Default: allow without modification
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

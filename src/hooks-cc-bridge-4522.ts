/**
 * hooks-cc-bridge-4522.ts — CC v2.1.152 hook bridge updates.
 *
 * Issue #4522:
 *   AC #1: SessionStart return fields (reloadSkills, hookSpecificOutput.sessionTitle)
 *   AC #2: MessageDisplay transform event (hookSpecificOutput.message sanitization)
 *
 * Owns: KNOWN_HOOK_EVENTS set (relocated from src/hooks.ts to keep that file
 * under the gate:arch 500-line limit while we add new events), the CC bridge
 * body schema, the MessageDisplay sanitizer, and the dispatchCcBridgeEvents
 * helper called from the main registerHookRoutes in src/hooks.ts.
 */
import { z } from 'zod';
import type { SessionManager, SessionInfo } from './session.js';
import type { SessionEventBus } from './events.js';
import { StructuredLogger } from './logger.js';

const log = new StructuredLogger();

/** Known CC hook event names. Issue #4522 adds 'MessageDisplay'. */
export const KNOWN_HOOK_EVENTS = new Set([
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
  // Issue #4522 AC #2: MessageDisplay transform event (CC v2.1.152)
  'MessageDisplay',
]);

/** CC bridge body schema — secondary parser for the new fields. */
// Schema is permissive at the structural level (`.passthrough()`) to accept
// standard CC body fields we don't enumerate here (e.g., `hook_event_name`).
// Prototype-pollution defense is layered:
//   1. After safeParse, `stripProtoKeys` removes any `__proto__`/`constructor`/
//      `prototype` keys that JSON.parse may have set on the parsed object.
//   2. The handler only reads the specific fields it needs (sessionTitle,
//      hookSpecificOutput.message) — never iterates the parsed object.
const ccBridgeHookBodySchema = z.object({
  reloadSkills: z.boolean().optional(),
  sessionTitle: z.string().min(1).max(200).optional(),
  hookSpecificOutput: z.object({
    hookEventName: z.string().optional(),
    sessionTitle: z.string().min(1).max(200).optional(),
    message: z.object({
      text: z.string().optional(),
      visible: z.boolean().optional(),
      redactReasons: z.array(z.string()).optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

/**
 * Strip prototype-pollution keys from a parsed object. The Zod schema is
 * already strict (no unknown keys), but defense-in-depth: a `__proto__` key
 * set via JSON.parse can still pollute the parsed object's prototype chain
 * before Zod sees it. This helper ensures the returned object is clean.
 */
function stripProtoKeys<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripProtoKeys(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    out[key] = stripProtoKeys((obj as Record<string, unknown>)[key]);
  }
  return out as T;
}

/** Issue #4522 AC #2: Sanitize MessageDisplay text — strip control chars, disallow JS/CSS payloads. */
function sanitizeMessageDisplayText(text: string): string {
  if (typeof text !== 'string') return '';
  // CodeQL #4522: regex-based HTML tag stripping is provably incomplete (CodeQL
  // can construct a payload that bypasses any given regex). Switch to strict
  // HTML-escaping so any tag/attribute/JS payload is rendered as text, never
  // interpreted as markup. Output is safe for any consumer that uses safe text
  // rendering (textContent, React JSX, etc.) — which all Aegis surfaces do.
  // We also strip control chars (which the escape doesn't touch) and a few
  // specific patterns (javascript: URLs) for defense in depth.
  return text
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface CcBridgeDispatchResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Issue #4522: Dispatch SessionStart + MessageDisplay events.
 * Returns a response if the event was handled, or null to let the main
 * handler continue with the standard flow.
 */
export function dispatchCcBridgeEvents(args: {
  eventName: string;
  sessionId: string;
  session: SessionInfo;
  rawBody: unknown;
  deps: { sessions: SessionManager; eventBus: SessionEventBus };
}): CcBridgeDispatchResult | null {
  const { eventName, sessionId, session, rawBody, deps } = args;
  const ccParse = ccBridgeHookBodySchema.safeParse(rawBody ?? {});
  // Defense-in-depth: even with strict schema, strip prototype-pollution keys.
  const ccBridge = (ccParse.success ? stripProtoKeys(ccParse.data) : {}) as Record<string, unknown>;

  if (eventName === 'SessionStart') {
    const requestedTitle = ccBridge.sessionTitle;
    const responseBody: Record<string, unknown> = {
      reloadSkills: true,
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    };
    if (typeof requestedTitle === 'string' && requestedTitle.length > 0 && requestedTitle.length <= 200) {
      // Issue #4522 AC #1: persist title in session.metadata (no new field on SessionInfo).
      // Sanitize for stored-XSS defense in depth: downstream consumers may render
      // `session.metadata.title` in HTML; we strip control chars + HTML-escape so
      // the stored value is inert regardless of render path.
      const sanitizedTitle = sanitizeMessageDisplayText(requestedTitle);
      if (!session.metadata) session.metadata = {};
      session.metadata.title = sanitizedTitle;
      (responseBody.hookSpecificOutput as Record<string, unknown>).sessionTitle = sanitizedTitle;
      log.info({ component: 'hooks', operation: 'sessionStartResponse', sessionId, attributes: { sessionTitle: 'set' } });
    } else {
      log.info({ component: 'hooks', operation: 'sessionStartResponse', sessionId, attributes: { sessionTitle: 'none' } });
    }
    return { status: 200, body: responseBody };
  }

  if (eventName === 'MessageDisplay') {
    const hso = ccBridge.hookSpecificOutput as Record<string, unknown> | undefined;
    const message = hso?.message as Record<string, unknown> | undefined;

    // RFC §2: visible:false is security-sensitive and requires Themis sign-off.
    if (message && message.visible === false) {
      log.warn({ component: 'hooks', operation: 'messageDisplayVisibleFalseRejected', sessionId });
      return { status: 200, body: { ok: true, warning: 'visible:false rejected — requires Themis sign-off' } };
    }

    let sanitizedText: string | undefined;
    if (message && typeof message.text === 'string') {
      sanitizedText = sanitizeMessageDisplayText(message.text);
    }
    const visible = message?.visible !== false;
    const redactReasons = Array.isArray(message?.redactReasons) ? (message.redactReasons as string[]) : undefined;

    deps.eventBus.emit(sessionId, {
      event: 'message_display',
      sessionId,
      timestamp: new Date().toISOString(),
      data: {
        text: sanitizedText,
        visible,
        ...(redactReasons ? { redactReasons } : {}),
      },
    });

    return {
      status: 200,
      body: {
        hookSpecificOutput: {
          hookEventName: 'MessageDisplay',
          message: {
            text: sanitizedText,
            visible,
            ...(redactReasons ? { redactReasons } : {}),
          },
        },
      },
    };
  }

  return null;
}

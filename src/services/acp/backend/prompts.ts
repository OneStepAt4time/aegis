/**
 * backend/prompts.ts — ACP Backend prompt delivery.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

import type { AcpJsonValue } from '../json-rpc-client.js';
import type { AcpSessionScope } from '../types.js';
import { StructuredLogger } from '../../../logger.js';
import { AcpBackendLifecycleError } from './errors.js';
import type { AcpBackendRuntime, AcpBackendStartResult, PendingHandshake } from './types.js';
import * as runtimeLifecycle from './runtime.js';
import type { AcpSessionRecord } from '../types.js';

const log = new StructuredLogger();

const ACP_PROMPT_ACK_TIMEOUT_MS = 5_000;

export interface PromptDeps {
  sessionService: {
    getSession(sessionId: string, scope: AcpSessionScope): Promise<{ acpAgentSessionId?: string | null }>;
  };
  inFlightPrompts: Map<string, AbortController>;
  /**
   * Issue #4779: ReadonlyMap view of in-flight background handshakes. Owned by
   * `AcpBackend`; mutations (`.set` / `.delete`) are producer-only (see
   * `backend.ts:launchBackgroundHandshake`). Compile-time invariant verified
   * by `acp-pendinghandshakes-readonly-4779.test.ts`.
   *
   * History: #4738 introduced the Map; #4760 widened the value type from
   * `Promise<unknown>` to the full outer shape for per-session dedup.
   */
  pendingHandshakes: ReadonlyMap<string, PendingHandshake>;
}

/**
 * Issue #4738: sendPrompt wrapper that awaits in-flight background handshakes
 * before falling through to autoResume. Prevents session/resume conflicts
 * with createSessionAsync's fire-and-forget handshake.
 */
export async function sendPromptWithHandshakeWait(
  deps: PromptDeps,
  runtimes: Map<string, unknown>,
  autoResume: (deps: PromptDeps, sessionId: string, scope: AcpSessionScope, cwd: string) => Promise<import('./types.js').AcpBackendRuntime | null>,
  sessionId: string,
  text: string,
  scope: AcpSessionScope,
  cwd?: string
): Promise<{ delivered: boolean; attempts: number; error?: string }> {
  let runtime = (runtimes as Map<string, import('./types.js').AcpBackendRuntime>).get(sessionId);

  // Issue #4738: Wait for in-flight background handshake before attempting autoResume.
  if (!runtime) {
    const pending = deps.pendingHandshakes.get(sessionId);
    if (pending) {
      try {
        await pending.ready;
      } catch {
        // Background handshake failed; fall through below.
      }
      runtime = (runtimes as Map<string, import('./types.js').AcpBackendRuntime>).get(sessionId);
    }
  }

  // Only attempt autoResume if no handshake was ever started (session is truly idle).
  if (!runtime && cwd && !deps.pendingHandshakes.has(sessionId)) {
    await autoResume(deps, sessionId, scope, cwd);
    runtime = (runtimes as Map<string, import('./types.js').AcpBackendRuntime>).get(sessionId);
  }

  if (!runtime) {
    return { delivered: false, attempts: 0, error: 'no_acp_runtime' };
  }
  return sendPrompt(deps, runtime, sessionId, text, scope);
}

/**
 * Issue #3093: Direct prompt delivery to ACP runtime.
 * Bypasses the action queue for immediate prompt delivery during session creation
 * and send_message API calls. Returns {delivered, attempts} matching the session.ts stub contract.
 * Issue #4705: Timeout on session/prompt now returns delivered:false (was incorrectly returning true).
 */
export async function sendPrompt(
  deps: PromptDeps,
  runtime: AcpBackendRuntime,
  sessionId: string,
  text: string,
  scope: AcpSessionScope
): Promise<{ delivered: boolean; attempts: number; error?: string }> {
  // Issue #2805: Reject concurrent prompts — CC blocks on background terminals
  const existing = deps.inFlightPrompts.get(sessionId);
  if (existing) {
    throw new AcpBackendLifecycleError(
      `Session ${sessionId} already has a prompt in-flight. ` +
      'Claude Code blocks on background terminals — wait for the current prompt to complete or cancel it.'
    );
  }

  const abort = new AbortController();
  deps.inFlightPrompts.set(sessionId, abort);

  try {
    const session = await deps.sessionService.getSession(sessionId, scope);
    const acpSessionId = session.acpAgentSessionId;
    if (!acpSessionId) {
      return { delivered: false, attempts: 0, error: 'no_agent_session' };
    }

    // Issue #4705: a session/prompt timeout originally meant "CC did not ack,
    // treat as not delivered". In practice the request is written to a live
    // JSON-RPC pipe and claude-agent-acp (single-threaded, in-order) DOES
    // process it — the ack simply lags past the window on idle/cold-resumed
    // sessions (verified: the reply appears in the transcript on every
    // observed timeout). A dead pipe rejects with a transport error, never a
    // timeout. So a timeout is a slow ack, not a non-delivery: surface
    // delivered:true and let the transcript be the source of truth. Actual
    // JSON-RPC errors (e.g. -32601 Method not found) are still thrown.
    try {
      await runtime.client.request('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text }],
      }, { timeoutMs: ACP_PROMPT_ACK_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof Error && err.name === 'AcpJsonRpcTimeoutError') {
        log.warn({ component: 'acp-backend', operation: 'promptAckTimeoutAccepted', attributes: { sessionId } });
        return { delivered: true, attempts: 1 };
      } else {
        throw err;
      }
    }
    return { delivered: true, attempts: 1 };
  } catch (err) {
    // Issue #4705: Re-throw JSON-RPC errors (not timeouts) so caller can handle them
    if (err instanceof Error && err.name !== 'AcpJsonRpcTimeoutError') {
      log.warn({ component: 'acp-backend', operation: 'promptError', attributes: { sessionId, error: err.message } });
      throw err;
    }
    // This path handles non-JSON-RPC errors (e.g. session service failures)
    log.warn({ component: 'acp-backend', operation: 'promptError', attributes: { sessionId, error: (err as Error).message } });
    return { delivered: false, attempts: 1, error: (err as Error).message };
  } finally {
    deps.inFlightPrompts.delete(sessionId);
  }
}

// Issue #4695: Auto-resume helper for sendPrompt.
// When no active runtime exists, attempt to resume the ACP session
// so iterative prompts can be delivered to idle sessions.
export async function autoResumeRuntime(
  runtimeDeps: import('./runtime.js').RuntimeLifecycleDeps,
  promptDeps: PromptDeps,
  sessionId: string,
  scope: AcpSessionScope,
  cwd: string
): Promise<AcpBackendRuntime | null> {
  try {
    const session = await promptDeps.sessionService.getSession(sessionId, scope);
    if (!session.acpAgentSessionId) {
      return null;
    }
    log.info({
      component: 'acp-backend',
      operation: 'autoResume',
      attributes: { sessionId, reason: 'no_acp_runtime' },
    });
    await runtimeLifecycle.startResumeRuntime(
      runtimeDeps,
      session as AcpSessionRecord,
      cwd,
    );
    return runtimeDeps.runtimes.get(sessionId) ?? null;
  } catch (err) {
    log.warn({
      component: 'acp-backend',
      operation: 'autoResumeFailed',
      attributes: { sessionId, error: String(err) },
    });
    return null;
  }
}

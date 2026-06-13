/**
 * backend/prompts.ts — ACP Backend prompt delivery.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

import type { AcpJsonValue } from '../json-rpc-client.js';
import type { AcpSessionScope } from '../types.js';
import { StructuredLogger } from '../../../logger.js';
import { AcpBackendLifecycleError } from './errors.js';
import type { AcpBackendRuntime } from './types.js';
import * as runtimeLifecycle from './runtime.js';
import type { AcpSessionRecord } from '../types.js';

const log = new StructuredLogger();

const ACP_PROMPT_ACK_TIMEOUT_MS = 5_000;

export interface PromptDeps {
  sessionService: {
    getSession(sessionId: string, scope: AcpSessionScope): Promise<{ acpAgentSessionId?: string | null }>;
  };
  inFlightPrompts: Map<string, AbortController>;
}

/**
 * Issue #3093: Direct prompt delivery to ACP runtime.
 * Bypasses the action queue for immediate prompt delivery during session creation
 * and send_message API calls. Returns {delivered, attempts} matching the session.ts stub contract.
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

    // #3479: Revert notify() back to request() with a short ack timeout.
    // #3423's notify() fix silently swallowed CC's -32601 "Method not found"
    // error because JSON-RPC notifications have no response. Using request()
    // with a 5s timeout: if CC acks within 5s → confirmed delivered. If it
    // times out → CC likely received it but hasn't responded yet → mark as
    // delivered (same behavior as notify, but with a chance to catch errors).
    // If CC returns an actual error (e.g. -32601) → surface it properly.
    try {
      await runtime.client.request('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text }],
      }, { timeoutMs: ACP_PROMPT_ACK_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof Error && err.name === 'AcpJsonRpcTimeoutError') {
        // Timeout is acceptable — CC likely received the prompt but hasn't
        // responded yet. Log and continue as delivered.
        log.warn({ component: 'acp-backend', operation: 'promptAckTimeout', attributes: { sessionId } });
      } else {
        // Actual error (e.g. -32601 Method not found) — surface it
        throw err;
      }
    }
    return { delivered: true, attempts: 1 };
  } catch (err) {
    if (err instanceof Error && err.name === 'AcpJsonRpcTimeoutError') {
      // Handled above — should not reach here, but defensive
      return { delivered: true, attempts: 1 };
    }
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

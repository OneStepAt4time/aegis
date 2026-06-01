/**
 * backend/actions.ts — ACP Backend action dispatch.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

import type { AcpJsonValue } from '../json-rpc-client.js';
import type { AcpActionRecord } from '../action-queue.js';
import type { AcpSessionScope } from '../types.js';
import { StructuredLogger } from '../../../logger.js';
import { AcpBackendLifecycleError } from './errors.js';
import type {
  AcpBackendRuntime,
  AcpBackendDispatchActionResult,
  AcpBackendCancelResult,
  AcpBackendShutdownResult,
  AcpBackendShutdownSessionInput,
} from './types.js';
import {
  isNonEmptyString,
  requireActionMetadataString,
  primitiveResultMetadata,
  assertNeverAction,
} from './utils.js';

const log = new StructuredLogger();

const ACP_PROMPT_REQUEST_TIMEOUT_MS = 60_000;

export interface ActionDeps {
  sessionService: {
    getSession(sessionId: string, scope: AcpSessionScope): Promise<{ acpAgentSessionId?: string | null; status: string }>;
    transition(sessionId: string, scope: AcpSessionScope, event: { type: string; warnings?: unknown }): Promise<unknown>;
  };
  inFlightPrompts: Map<string, AbortController>;
  strictValidation: boolean;
  emitValidationWarnings: boolean;
  shutdownSession(input: AcpBackendShutdownSessionInput): Promise<AcpBackendShutdownResult>;
  cancelSession(input: { sessionId: string; tenantId?: string; ownerKeyId?: string }): Promise<AcpBackendCancelResult>;
}

/**
 * Dispatch an action from the action queue to the appropriate ACP runtime method.
 * Handles: close, prompt, approve, reject, cancel. Throws for unimplemented types.
 */
export async function dispatchAction(
  deps: ActionDeps,
  runtime: AcpBackendRuntime,
  action: AcpActionRecord
): Promise<AcpBackendDispatchActionResult> {
  if (action.actionType === 'close') {
    const result = await deps.shutdownSession(action);
    return { resultMetadata: { status: result.session.status } };
  }

  const scope = scopeFromInput(action);
  const session = await deps.sessionService.getSession(action.sessionId, scope);
  const acpSessionId = session.acpAgentSessionId;
  if (!acpSessionId) {
    throw new AcpBackendLifecycleError(
      `Cannot dispatch ACP action ${action.actionId} before ACP agent attachment`
    );
  }

  switch (action.actionType) {
    case 'prompt':
      return dispatchPromptAction(deps, runtime, acpSessionId, action);
    case 'approve':
    case 'reject':
      return dispatchApprovalAction(runtime, action);
    case 'cancel': {
      const result = await deps.cancelSession(action);
      return { resultMetadata: primitiveResultMetadata(result.cancelResult) };
    }
    case 'pause':
    case 'resume':
    case 'driver_transfer':
    case 'intervene':
      throw new AcpBackendLifecycleError(
        `ACP action type ${action.actionType} has no runtime dispatch contract in ACP-046`
      );
    default:
      return assertNeverAction(action.actionType);
  }
}

export async function dispatchPromptAction(
  deps: ActionDeps,
  runtime: AcpBackendRuntime,
  acpSessionId: string,
  action: AcpActionRecord
): Promise<AcpBackendDispatchActionResult> {
  const sessionId = action.sessionId;

  // Issue #2805: Reject concurrent prompts — CC blocks on background terminals
  const existing = deps.inFlightPrompts.get(sessionId);
  if (existing) {
    throw new AcpBackendLifecycleError(
      `Session ${sessionId} already has a prompt in-flight (action ${action.actionId}). ` +
      'Claude Code blocks on background terminals — wait for the current prompt to complete or cancel it.'
    );
  }

  const abort = new AbortController();
  deps.inFlightPrompts.set(sessionId, abort);

  const text = requireActionMetadataString(action, 'text', 'prompt action metadata.text');
  await deps.sessionService.transition(sessionId, runtime.scope, { type: 'run_started' });

  try {
    const response = await runtime.client.request<AcpJsonValue>('session/prompt', {
      sessionId: acpSessionId,
      prompt: [{ type: 'text', text }],
    }, { timeoutMs: ACP_PROMPT_REQUEST_TIMEOUT_MS });

    // Issue #3853: Validate output for hallucination signatures
    // Issue #3900: Structured warnings + strict validation enforcement
    const { validatePromptOutput } = await import('../content-validation.js');
    const warnings = validatePromptOutput(response.result, text);
    if (warnings.length > 0) {
      log.warn({ component: 'acp-backend', operation: 'contentValidationWarning', attributes: { sessionId, actionId: action.actionId, warnings: JSON.stringify(warnings) } });

      // Issue #3897: Emit validation_warning event for monitoring/alerting (opt-in)
      if (deps.emitValidationWarnings) {
        try {
          await deps.sessionService.transition(sessionId, runtime.scope, {
            type: 'validation_warning',
            warnings,
          });
        } catch (err) {
          log.warn({ component: 'acp-backend', operation: 'validationWarningEmitFailed', attributes: { error: String(err) } });
        }
      }

      // Issue #3900: Strict mode — fail the action on validation warnings
      if (deps.strictValidation) {
        throw new AcpBackendLifecycleError(
          `ACP strict validation: ${warnings.length} warning(s) detected for action ${action.actionId} in session ${sessionId}: ${warnings.map(w => w.message).join('; ')}`
        );
      }
    }

    await deps.sessionService.transition(sessionId, runtime.scope, {
      type: 'run_completed',
    });
    const metadata = primitiveResultMetadata(response.result);
    return { resultMetadata: metadata };
  } catch (error) {
    if (error instanceof Error && error.name === 'AcpJsonRpcTimeoutError') {
      log.warn({ component: 'acp-backend', operation: 'promptTimeout', attributes: { sessionId, actionId: action.actionId, timeout: ACP_PROMPT_REQUEST_TIMEOUT_MS } });
    }
    try {
      await deps.sessionService.transition(sessionId, runtime.scope, {
        type: 'runtime_failed',
      });
    } catch (transitionError) {
      log.error({ component: 'acp-backend', operation: 'transitionToFailedError', attributes: { sessionId, error: String(transitionError) } });
    }
    throw error;
  } finally {
    deps.inFlightPrompts.delete(sessionId);
  }
}

export async function dispatchApprovalAction(
  runtime: AcpBackendRuntime,
  action: AcpActionRecord
): Promise<AcpBackendDispatchActionResult> {
  if (!isNonEmptyString(action.approvalId)) {
    throw new AcpBackendLifecycleError(
      `ACP ${action.actionType} action ${action.actionId} requires approvalId`
    );
  }
  const optionId = requireActionMetadataString(
    action,
    'optionId',
    'approval action metadata.optionId'
  );
  await runtime.client.respond(action.approvalId, {
    outcome: {
      outcome: 'selected',
      optionId,
    },
  });
  return {
    resultMetadata: {
      approvalId: action.approvalId ?? '',
      outcome: 'selected',
    },
  };
}

function scopeFromInput(input: { tenantId?: string; ownerKeyId?: string }): AcpSessionScope {
  return { tenantId: input.tenantId ?? '', ownerKeyId: input.ownerKeyId ?? '' };
}

/**
 * backend/utils.ts — ACP Backend utility functions.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AcpJsonObject, AcpJsonValue } from '../json-rpc-client.js';
import type { AcpActionRecord } from '../action-queue.js';
import type {
  AcpAgentSessionAttachment,
  AcpBackendMetadata,
  AcpBackendMetadataValue,
  AcpCreateSessionInput,
  AcpSessionRecord,
  AcpSessionScope,
} from '../types.js';
import type { AcpChildProcess, AcpChildProcessOptions } from '../child-process.js';
import type { AcpJsonRpcClientOptions } from '../json-rpc-client.js';
import {
  AcpBackendLifecycleError,
  AcpBackendRuntimeUnavailableError,
} from './errors.js';
import type {
  AcpBackendClient,
  AcpBackendClientFactoryContext,
  AcpBackendCreateSessionInput,
  AcpBackendInitializeResult,
  AcpBackendSessionResult,
} from './types.js';
import { AcpChildProcess as AcpChildProcessCtor } from '../child-process.js';
import { AcpJsonRpcClient } from '../json-rpc-client.js';
import { StructuredLogger } from '../../../logger.js';

const log = new StructuredLogger();

/**
 * Issue #4704: Fatal CC stderr patterns that indicate the runtime is in an
 * unrecoverable state. When detected, Aegis shuts down the child process
 * to trigger runtime_failed transition rather than letting the session hang.
 */
const FATAL_CC_STDERR_PATTERNS = [
  /No onPostToolUseHook found for tool use ID/,
  /Error handling request[\s\S]*session\/prompt/,
];

export function createDefaultAcpBackendClient(
  context: AcpBackendClientFactoryContext,
  options: {
    childProcessOptions?: Omit<AcpChildProcessOptions, 'cwd'>;
    jsonRpcClientOptions?: Omit<AcpJsonRpcClientOptions, 'child'>;
  } = {},
  /**
   * Optional injected child process for testing. When omitted, a real
   * AcpChildProcess is spawned.
   */
  injectedChild?: AcpChildProcess
): AcpBackendClient {
  const child = injectedChild ?? new AcpChildProcessCtor({
    ...options.childProcessOptions,
    cwd: context.cwd,
    // Issue #4522 AC #3: forward the session's effective permission mode from
    // the clientFactory context. options.childProcessOptions (if provided) takes
    // precedence via spread; the context value fills in when the caller didn't
    // override. The downstream resolveCommand() passes this to
    // applyPermissionModeArgs(), which injects --permission-mode at spawn.
    permissionMode: options.childProcessOptions?.permissionMode ?? context.permissionMode,
  });
  // Issue #3135: Forward ACP child process stderr for debugging.
  // Without this, errors from claude-agent-acp (API key issues, crashes)
  // are silently discarded, making diagnosis impossible.
  child.on('stderr', (event) => {
    const text = typeof event.chunk === 'string' ? event.chunk.trim() : '';
    if (!text) return;

    // Issue #4704: Detect fatal CC errors and trigger shutdown.
    const isFatal = FATAL_CC_STDERR_PATTERNS.some(pattern => pattern.test(text));
    if (isFatal) {
      log.error({ component: 'acp-backend', operation: 'fatalStderrDetected', attributes: { sessionId: context.durableSessionId.slice(0, 8), text, action: 'shutting_down_runtime' } });
      void child.shutdown().catch(err => {
        log.error({ component: 'acp-backend', operation: 'fatalStderrShutdownFailed', attributes: { sessionId: context.durableSessionId.slice(0, 8), error: String(err) } });
      });
    } else {
      log.error({ component: 'acp-backend', operation: 'childStderr', attributes: { sessionId: context.durableSessionId.slice(0, 8), text } });
    }
  });
  return new AcpJsonRpcClient({
    ...options.jsonRpcClientOptions,
    child,
    idNamespace:
      options.jsonRpcClientOptions?.idNamespace ?? `aegis-acp-${context.durableSessionId}`,
  });
}

export function scopeFromInput(input: AcpSessionScope): AcpSessionScope {
  return { tenantId: input.tenantId, ownerKeyId: input.ownerKeyId };
}

export function toCreateSessionInput(input: AcpBackendCreateSessionInput): AcpCreateSessionInput {
  return {
    tenantId: input.tenantId,
    ownerKeyId: input.ownerKeyId,
    parentSessionId: input.parentSessionId,
    rootSessionId: input.rootSessionId,
    correlationId: input.correlationId,
    resumeFromSessionId: input.resumeFromSessionId,
    backendMetadata: input.backendMetadata,
  };
}

export function attachmentFromResult(
  result: AcpBackendSessionResult,
  backendRunId: string
): AcpAgentSessionAttachment {
  if (!isNonEmptyString(result.sessionId)) {
    throw new AcpBackendLifecycleError('ACP session lifecycle response omitted sessionId');
  }
  return {
    acpAgentSessionId: result.sessionId,
    ...(isNonEmptyString(result.claudeSessionId)
      ? { claudeSessionId: result.claudeSessionId }
      : {}),
    backendRunId,
  };
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function requireActionMetadataString(action: AcpActionRecord, key: string, label: string): string {
  const value = optionalActionMetadataString(action, key);
  if (value === undefined) {
    throw new AcpBackendLifecycleError(
      `ACP ${action.actionType} action ${action.actionId} requires ${label}`
    );
  }
  return value;
}

export function optionalActionMetadataString(action: AcpActionRecord, key: string): string | undefined {
  const value = action.metadata?.[key];
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) {
    throw new AcpBackendLifecycleError(
      `ACP ${action.actionType} action ${action.actionId} metadata.${key} must be a non-empty string`
    );
  }
  return value;
}


/** Issue #3853: Post-response content validation for hallucination signatures */




export function primitiveResultMetadata(result: AcpJsonValue): AcpBackendMetadata {
  const metadata: AcpBackendMetadata = {};
  if (!isJsonObject(result)) return metadata;
  for (const [key, value] of Object.entries(result)) {
    if (isBackendMetadataValue(value)) {
      metadata[key] = value;
    }
  }
  return metadata;
}

export function isJsonObject(value: AcpJsonValue): value is AcpJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBackendMetadataValue(value: AcpJsonValue): value is AcpBackendMetadataValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function assertNeverAction(value: never): never {
  throw new Error(`Unhandled ACP action type: ${value}`);
}

export function isActiveStatus(status: AcpSessionRecord['status']): boolean {
  return (
    status === 'initializing' ||
    status === 'idle' ||
    status === 'running' ||
    status === 'paused' ||
    status === 'intervening'
  );
}

export function readPackageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const pkg: unknown = JSON.parse(readFileSync(join(currentDir, '../../../../package.json'), 'utf8'));
  if (typeof pkg !== 'object' || pkg === null || !('version' in pkg)) {
    return '0.0.0';
  }
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

export function hasLoadSessionCapability(initializeResult: AcpBackendInitializeResult): boolean {
  const capabilities = initializeResult.agentCapabilities;
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    return false;
  }
  return (capabilities as Record<string, unknown>).loadSession === true;
}

// Re-export errors for backward compatibility (Issue #4534)
export {
  AcpBackendLifecycleError,
  AcpBackendRuntimeUnavailableError,
} from './errors.js';

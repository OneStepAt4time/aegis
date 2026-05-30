/**
 * acp-backend-utils.ts — Utility functions for the ACP backend lifecycle manager.
 *
 * Pure functions extracted from backend.ts for reuse and testability.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AcpActionRecord } from './action-queue.js';
import type { AcpJsonObject, AcpJsonValue } from './json-rpc-client.js';
import type {
  AcpAgentSessionAttachment,
  AcpBackendMetadata,
  AcpBackendMetadataValue,
  AcpCreateSessionInput,
  AcpSessionRecord,
  AcpSessionScope,
} from './types.js';

import { AcpBackendLifecycleError } from './acp-backend-errors.js';
import type { AcpBackendInitializeResult, AcpBackendSessionResult } from './acp-backend-types.js';

export function scopeFromInput(input: AcpSessionScope): AcpSessionScope {
  return { tenantId: input.tenantId, ownerKeyId: input.ownerKeyId };
}

export function toCreateSessionInput(input: AcpCreateSessionInput): AcpCreateSessionInput {
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
  const pkg: unknown = JSON.parse(readFileSync(join(currentDir, '../../../package.json'), 'utf8'));
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

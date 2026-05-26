import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  type AcpCapturedFrame,
  type AcpNormalizedEvent,
  normalizeAcpFrames,
} from './acp-event-stream.js';
import { buildAcpResolveEnv, buildAcpSpawnEnv } from './acp-spawn-env.js';
import {
  resolveClaudeAgentAcpBinary,
  type AcpCommandSource,
  type ResolveAcpCommandOptions,
  type ResolvedAcpCommand,
} from './services/acp/binary-resolver.js';

export type { AcpCapturedFrame, AcpNormalizedEvent } from './acp-event-stream.js';
export {
  AcpBinaryResolutionError,
  resolveClaudeAgentAcpBinary as resolveAcpCommand,
  type AcpCommandSource,
  type ResolveAcpCommandOptions,
  type ResolvedAcpCommand,
} from './services/acp/binary-resolver.js';

import {
  // Constants
  DEFAULT_TIMEOUT_MS,
  EXIT_TIMEOUT_MS,
  STDERR_LIMIT_BYTES,
  APPROVAL_STRING_LIMIT_BYTES,
  APPROVAL_ARRAY_LIMIT_ITEMS,
  APPROVAL_OBJECT_LIMIT_KEYS,
  APPROVAL_WRITE_EXIT_GRACE_MS,
  REDACTED_ACP_VALUE,
  // Public types
  type AcpModelProvider,
  type AcpPermissionOptionKind,
  type AcpApprovalState,
  type AcpApprovalRejectionReason,
  type Platform,
  type JsonObject,
  type JsonRpcId,
  type AcpAgentInfo,
  type AcpInitializeResult,
  type AcpNewSessionResult,
  type AcpPromptResult,
  type JsonRpcSuccess,
  type JsonRpcNotification,
  type AcpPermissionOption,
  type AcpApprovalToolCall,
  type AcpSelectedApprovalOutcome,
  type AcpCancelledApprovalOutcome,
  type AcpApprovalOutcome,
  type AcpApprovalResponse,
  type AcpApprovalDecision,
  type AcpApprovalRequest,
  type AcpLifecycleProbeOptions,
  type AcpModelPassthroughSummary,
  type AcpLifecycleProbeResult,
} from './acp-lifecycle/acp-lifecycle-types.js';

// Import for local use
import { AcpProtocolError } from './acp-lifecycle/acp-lifecycle-types.js';

// Import extracted transport module (#4235 step 2)
import {
  requireInitializeResponse,
  requireNewSessionResponse,
  requirePromptResponse,
  requireObjectResponse,
  NdjsonRpcTransport,
} from './acp-lifecycle/ndjson-rpc-transport.js';

// Re-exports for backward compatibility
export {
  REDACTED_ACP_VALUE,
  type AcpModelProvider,
  type AcpPermissionOptionKind,
  type AcpApprovalState,
  type AcpApprovalRejectionReason,
  type JsonObject,
  type AcpAgentInfo,
  type AcpInitializeResult,
  type AcpNewSessionResult,
  type AcpPromptResult,
  type JsonRpcSuccess,
  type JsonRpcNotification,
  type AcpPermissionOption,
  type AcpApprovalToolCall,
  type AcpSelectedApprovalOutcome,
  type AcpCancelledApprovalOutcome,
  type AcpApprovalOutcome,
  type AcpApprovalResponse,
  type AcpApprovalDecision,
  type AcpApprovalRequest,
  type AcpLifecycleProbeOptions,
  type AcpModelPassthroughSummary,
  type AcpLifecycleProbeResult,
} from './acp-lifecycle/acp-lifecycle-types.js';
export { AcpProtocolError } from './acp-lifecycle/acp-lifecycle-types.js';
export { NdjsonRpcTransport } from './acp-lifecycle/ndjson-rpc-transport.js';
export {
  requireInitializeResponse,
  requireNewSessionResponse,
  requirePromptResponse,
  requireObjectResponse,
} from './acp-lifecycle/ndjson-rpc-transport.js';
const BYO_LLM_PROVIDER_ENV_KEYS: Record<AcpModelProvider, readonly string[]> = {
  anthropic: [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_FAST_MODEL',
    'ANTHROPIC_DEFAULT_MODEL',
    'API_TIMEOUT_MS',
  ],
  glm: [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_FAST_MODEL',
    'ANTHROPIC_DEFAULT_MODEL',
    'API_TIMEOUT_MS',
  ],
  openrouter: [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_FAST_MODEL',
    'ANTHROPIC_DEFAULT_MODEL',
    'API_TIMEOUT_MS',
  ],
  'lm-studio': [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_FAST_MODEL',
    'ANTHROPIC_DEFAULT_MODEL',
    'API_TIMEOUT_MS',
  ],
  ollama: [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_FAST_MODEL',
    'ANTHROPIC_DEFAULT_MODEL',
    'API_TIMEOUT_MS',
  ],
  'azure-openai': [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_DEFAULT_FAST_MODEL',
    'ANTHROPIC_DEFAULT_MODEL',
    'API_TIMEOUT_MS',
  ],
};

function parseAcpModelProvider(provider: string): AcpModelProvider {
  const normalized = provider.trim().toLowerCase();
  if (normalized === '') {
    throw new AcpProtocolError('ACP model provider must be a non-empty string');
  }
  switch (normalized) {
    case 'anthropic':
    case 'glm':
    case 'openrouter':
    case 'lm-studio':
    case 'ollama':
    case 'azure-openai':
      return normalized;
    default:
      throw new AcpProtocolError(`Unsupported ACP model provider: ${provider}`);
  }
}

function buildAcpModelPassthrough(options: AcpLifecycleProbeOptions): AcpModelPassthrough {
  const model = normalizeOptionalModel(options.model);
  const provider =
    options.modelProvider === undefined ? undefined : parseAcpModelProvider(options.modelProvider);
  const providerEnv = normalizeProviderEnv(provider, options.providerEnv);
  const sessionMeta = buildSessionMeta(provider, model, providerEnv);
  const summary = buildModelPassthroughSummary(provider, model, providerEnv);
  return {
    summary,
    env: providerEnv,
    sessionMeta,
    sensitiveValues: sensitiveValuesFromEnv(providerEnv),
  };
}

function normalizeOptionalModel(model: string | undefined): string | undefined {
  if (model === undefined) return undefined;
  const trimmed = model.trim();
  if (trimmed === '') {
    throw new AcpProtocolError('ACP model must be a non-empty string');
  }
  if (/[\r\n\0]/.test(trimmed)) {
    throw new AcpProtocolError('ACP model must not contain control characters');
  }
  return trimmed;
}

function normalizeProviderEnv(
  provider: AcpModelProvider | undefined,
  providerEnv: Record<string, string | undefined> | undefined
): Record<string, string> {
  if (!providerEnv) return {};
  const entries = Object.entries(providerEnv).filter(([, rawValue]) => rawValue !== undefined);
  if (entries.length === 0) return {};

  if (!provider) {
    throw new AcpProtocolError('ACP model provider is required when providerEnv is set');
  }

  const allowed = new Set(BYO_LLM_PROVIDER_ENV_KEYS[provider]);
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    if (rawValue === undefined) continue;
    const key = rawKey.trim().toUpperCase();
    if (!allowed.has(key)) {
      throw new AcpProtocolError(`Provider env ${rawKey} is not allowlisted for ${provider}`);
    }
    if (rawValue.trim() === '') {
      throw new AcpProtocolError(`Provider env ${key} must be a non-empty string`);
    }
    if (/[\r\n\0]/.test(rawValue)) {
      throw new AcpProtocolError(`Provider env ${key} must not contain control characters`);
    }
    if (key === 'API_TIMEOUT_MS' && !/^[1-9]\d*$/.test(rawValue)) {
      throw new AcpProtocolError('Provider env API_TIMEOUT_MS must be a positive integer string');
    }
    normalized[key] = rawValue;
  }
  return normalized;
}

function buildSessionMeta(
  provider: AcpModelProvider | undefined,
  model: string | undefined,
  providerEnv: Record<string, string>
): JsonObject | undefined {
  const envKeys = Object.keys(providerEnv);
  if (!provider && !model && envKeys.length === 0) return undefined;

  const meta: JsonObject = {};
  if (provider) {
    meta.aegis = { modelProvider: provider };
  }

  const claudeOptions: JsonObject = {};
  if (model) {
    claudeOptions.model = model;
  }
  if (envKeys.length > 0) {
    claudeOptions.env = providerEnv;
  }

  if (Object.keys(claudeOptions).length > 0) {
    meta.claudeCode = { options: claudeOptions };
  }
  return meta;
}

function buildModelPassthroughSummary(
  provider: AcpModelProvider | undefined,
  model: string | undefined,
  providerEnv: Record<string, string>
): AcpModelPassthroughSummary {
  const envKeys = Object.keys(providerEnv).sort();
  const env: Record<string, string> = {};
  for (const key of envKeys) {
    env[key] = isSensitiveKey(key) ? REDACTED_ACP_VALUE : providerEnv[key];
  }
  const summary: AcpModelPassthroughSummary = { env, envKeys };
  if (provider) summary.provider = provider;
  if (model) summary.model = model;
  return summary;
}

function sensitiveValuesFromEnv(env: Record<string, string>): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (isSensitiveKey(key) && value !== '') {
      values.push(value);
    }
  }
  return values;
}

function isSensitiveKey(key: string): boolean {
  return /(?:AUTH|TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key);
}

export async function runAcpLifecycleProbe(
  options: AcpLifecycleProbeOptions
): Promise<AcpLifecycleProbeResult> {
  const modelPassthrough = buildAcpModelPassthrough(options);
  let resolvedCommand: ResolvedAcpCommand;
  if (options.resolvedCommand) {
    resolvedCommand = options.resolvedCommand;
  } else if (options.command) {
    resolvedCommand = {
      command: options.command,
      args: [...(options.args ?? [])],
      source: 'explicit',
    };
  } else {
    resolvedCommand = resolveClaudeAgentAcpBinary({
      cwd: options.cwd,
      env: buildAcpResolveEnv(options.env),
    });
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn(resolvedCommand.command, resolvedCommand.args, {
    cwd: options.cwd,
    env: buildAcpSpawnEnv(options.env, modelPassthrough.env),
    stdio: 'pipe',
    windowsHide: true,
  });

  const transport = new NdjsonRpcTransport(child, timeoutMs, modelPassthrough.sensitiveValues, {
    cancelAfterApprovalRequest: options.cancelAfterApprovalRequest,
    decision: options.approvalDecision,
  });
  let sessionId = '';
  let resumeResult: JsonRpcSuccess<JsonObject> | undefined;
  let promptResult: JsonRpcSuccess<AcpPromptResult> | undefined;
  let closeResult: JsonRpcSuccess<JsonObject> | undefined;

  try {
    const initialize = requireInitializeResponse(
      await transport.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: options.clientCapabilities ?? {},
        clientInfo: {
          name: 'aegis-acp-lifecycle-probe',
          title: 'Aegis ACP Lifecycle Probe',
          version: '0.0.0-spike',
        },
      })
    );

    const newSession = requireNewSessionResponse(
      await transport.request('session/new', {
        ...buildSessionRequestParams(
          options.sessionCwd ?? options.cwd,
          modelPassthrough.sessionMeta
        ),
      })
    );
    sessionId = newSession.result.sessionId;

    if (options.resumeSession) {
      resumeResult = requireObjectResponse(
        await transport.request('session/resume', {
          sessionId,
          ...buildSessionRequestParams(
            options.sessionCwd ?? options.cwd,
            modelPassthrough.sessionMeta
          ),
        })
      );
    }

    if (options.prompt !== undefined) {
      if (options.cancelAfterFirstUpdate) {
        transport.cancelOnNextAgentMessage(sessionId);
      }
      promptResult = requirePromptResponse(
        await transport.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: options.prompt }],
        })
      );
    }

    if (options.closeSession) {
      closeResult = requireObjectResponse(
        await transport.request('session/close', {
          sessionId,
        })
      );
    }

    child.stdin.end();
    const exit = await transport.waitForExit(EXIT_TIMEOUT_MS);

    return {
      command: resolvedCommand,
      initialize,
      newSession,
      sessionId,
      resume: resumeResult,
      prompt: promptResult,
      close: closeResult,
      frames: transport.frames,
      normalizedEvents: normalizeAcpFrames(transport.frames),
      notifications: transport.notifications,
      approvalRequests: transport.approvalRequests,
      stderr: transport.stderr,
      modelPassthrough: modelPassthrough.summary,
      cancelSent: transport.cancelSent,
      exit,
    };
  } finally {
    await transport.dispose();
  }
}

function buildSessionRequestParams(cwd: string, sessionMeta: JsonObject | undefined): JsonObject {
  const params: JsonObject = {
    cwd,
    mcpServers: [],
  };
  if (sessionMeta) {
    params._meta = sessionMeta;
  }
  return params;
}



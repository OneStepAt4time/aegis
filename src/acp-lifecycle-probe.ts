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
  DEFAULT_TIMEOUT_MS,
  EXIT_TIMEOUT_MS,
  STDERR_LIMIT_BYTES,
  APPROVAL_STRING_LIMIT_BYTES,
  APPROVAL_ARRAY_LIMIT_ITEMS,
  APPROVAL_OBJECT_LIMIT_KEYS,
  APPROVAL_WRITE_EXIT_GRACE_MS,
  REDACTED_ACP_VALUE,
  BYO_LLM_PROVIDER_ENV_KEYS,
} from './acp-lifecycle/acp-lifecycle-types.js';

import type {
  AcpModelProvider,
  AcpPermissionOptionKind,
  AcpApprovalState,
  AcpApprovalRejectionReason,
  Platform,
  JsonObject,
  JsonRpcId,
  AcpAgentInfo,
  AcpInitializeResult,
  AcpNewSessionResult,
  AcpPromptResult,
  JsonRpcSuccess,
  JsonRpcNotification,
  AcpPermissionOption,
  AcpApprovalToolCall,
  AcpSelectedApprovalOutcome,
  AcpCancelledApprovalOutcome,
  AcpApprovalOutcome,
  AcpApprovalResponse,
  AcpApprovalDecision,
  AcpApprovalRequest,
  AcpLifecycleProbeOptions,
  AcpModelPassthroughSummary,
  AcpLifecycleProbeResult,
  PendingRequest,
  AcpModelPassthrough,
  PendingApprovalRequest,
  NormalizedApprovalRequest,
  ApprovalHandlingOptions,
} from './acp-lifecycle/acp-lifecycle-types.js';
// Re-export types/constants so the public surface of this module is unchanged
export {
  DEFAULT_TIMEOUT_MS,
  EXIT_TIMEOUT_MS,
  STDERR_LIMIT_BYTES,
  APPROVAL_STRING_LIMIT_BYTES,
  APPROVAL_ARRAY_LIMIT_ITEMS,
  APPROVAL_OBJECT_LIMIT_KEYS,
  APPROVAL_WRITE_EXIT_GRACE_MS,
  REDACTED_ACP_VALUE,
  BYO_LLM_PROVIDER_ENV_KEYS,
} from './acp-lifecycle/acp-lifecycle-types.js';

export type {
  AcpModelProvider,
  AcpPermissionOptionKind,
  AcpApprovalState,
  AcpApprovalRejectionReason,
  Platform,
  JsonObject,
  JsonRpcId,
  AcpAgentInfo,
  AcpInitializeResult,
  AcpNewSessionResult,
  AcpPromptResult,
  JsonRpcSuccess,
  JsonRpcNotification,
  AcpPermissionOption,
  AcpApprovalToolCall,
  AcpSelectedApprovalOutcome,
  AcpCancelledApprovalOutcome,
  AcpApprovalOutcome,
  AcpApprovalResponse,
  AcpApprovalDecision,
  AcpApprovalRequest,
  AcpLifecycleProbeOptions,
  AcpModelPassthroughSummary,
  AcpLifecycleProbeResult,
  PendingRequest,
  AcpModelPassthrough,
  PendingApprovalRequest,
  NormalizedApprovalRequest,
  ApprovalHandlingOptions,
} from './acp-lifecycle/acp-lifecycle-types.js';

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

class NdjsonRpcTransport {
  readonly frames: AcpCapturedFrame[] = [];
  readonly notifications: JsonRpcNotification[] = [];
  readonly approvalRequests: AcpApprovalRequest[] = [];
  stderr = '';
  cancelSent = false;

  private nextId = 1;
  private stdoutBuffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pendingApprovals = new Map<JsonRpcId, PendingApprovalRequest>();
  private protocolFailure: AcpProtocolError | null = null;
  private cancelOnAgentMessageSessionId: string | null = null;
  private exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private exited = false;
  private activeWrites = 0;
  private approvalWriteClassifications = 0;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number,
    private readonly sensitiveValues: readonly string[],
    private readonly approvalHandling: ApprovalHandlingOptions = {}
  ) {
    this.exitPromise = new Promise(resolve => {
      let exitResult: { code: number | null; signal: NodeJS.Signals | null } | undefined;
      child.once('exit', (code, signal) => {
        this.exited = true;
        exitResult = { code, signal };
      });
      child.once('close', (code, signal) => {
        this.exited = true;
        const finalCode = code ?? exitResult?.code ?? null;
        const finalSignal = signal ?? exitResult?.signal ?? null;
        if (this.pendingApprovals.size > 0) {
          this.failPendingOnExit(finalCode, finalSignal);
          this.failOnResidualStdoutBuffer();
        } else {
          this.failOnResidualStdoutBuffer();
          this.failPendingOnExit(finalCode, finalSignal);
        }
        resolve({ code: finalCode, signal: finalSignal });
      });
    });

    child.once('error', error => {
      this.fail(
        new AcpProtocolError('ACP child process failed to start', { message: error.message })
      );
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr = appendLimited(this.stderr, chunk, STDERR_LIMIT_BYTES);
    });
    child.stdin.on('error', error => {
      const activeWritesAtError = this.activeWrites;
      setImmediate(() => {
        if (activeWritesAtError > 0) return;
        if (this.approvalWriteClassifications > 0) return;
        if (!this.protocolFailure) {
          this.fail(new AcpProtocolError('ACP stdin write failed', { message: error.message }));
        }
      });
    });
  }

  cancelOnNextAgentMessage(sessionId: string): void {
    this.cancelOnAgentMessageSessionId = sessionId;
  }

  async request(method: string, params: JsonObject): Promise<JsonRpcSuccess<unknown>> {
    this.throwIfFailed();
    const id = this.nextId;
    this.nextId += 1;

    const response = new Promise<JsonRpcSuccess<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const pendingApprovals = this.rejectPendingApprovals('request_timeout', true);
        reject(
          new AcpProtocolError('ACP request timed out', {
            method,
            id,
            timeoutMs: this.timeoutMs,
            pendingApprovals,
          })
        );
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
    });

    try {
      await this.write({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      const protocolError = toAcpProtocolError(error, 'ACP request write failed', { method, id });
      this.fail(protocolError);
      throw protocolError;
    }
    return response;
  }

  async waitForExit(
    timeoutMs: number
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    const exit = await Promise.race([
      this.exitPromise,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) => {
        setTimeout(
          () => reject(new AcpProtocolError('ACP child process did not exit after stdin closed')),
          timeoutMs
        );
      }),
    ]);
    this.throwIfFailed();
    return exit;
  }

  async dispose(): Promise<void> {
    this.failOnResidualStdoutBuffer();
    this.rejectPendingApprovals('transport_disposed', true);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError('ACP transport disposed before response', {
          method: pending.method,
          id,
        })
      );
    }
    this.pending.clear();

    if (!this.exited) {
      if (!this.child.stdin.destroyed) {
        this.child.stdin.end();
      }
      this.child.kill('SIGTERM');
      await Promise.race([
        this.exitPromise,
        new Promise<void>(resolve => {
          setTimeout(resolve, EXIT_TIMEOUT_MS);
        }),
      ]);
      if (!this.exited) {
        this.child.kill('SIGKILL');
        await this.waitForExit(EXIT_TIMEOUT_MS);
      }
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) return;

      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim() === '') continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown JSON parse error';
        this.fail(
          new AcpProtocolError('ACP stdout contained a non-JSON line', {
            line: redactSensitiveString(line, this.sensitiveValues),
            message,
          })
        );
        return;
      }

      void this.handleMessage(parsed).catch(error => {
        this.fail(toAcpProtocolError(error, 'ACP stdout message handling failed'));
      });
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isJsonObject(message)) {
      this.fail(new AcpProtocolError('ACP stdout message was not a JSON object', { message }));
      return;
    }
    this.frames.push({ direction: 'agent_to_client', message });

    const id = message.id;
    if (
      typeof id === 'number' &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))
    ) {
      this.handleResponse(id, message);
      return;
    }

    const method = message.method;
    if (typeof method !== 'string') {
      this.fail(
        new AcpProtocolError('ACP message did not include a method or response id', { message })
      );
      return;
    }

    if (Object.hasOwn(message, 'id')) {
      if (!isJsonRpcId(id)) {
        this.fail(new AcpProtocolError('ACP request id was not a JSON-RPC id', { id, method }));
        return;
      }
      await this.handleClientRequest(id, method, message.params);
      return;
    }

    let notification: JsonRpcNotification;
    try {
      notification = normalizeNotification(message, method);
    } catch (error) {
      const protocolError =
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP notification could not be normalized');
      this.fail(protocolError);
      return;
    }
    this.notifications.push(notification);
    if (this.shouldCancelAfterNotification(notification)) {
      const sessionId = this.cancelOnAgentMessageSessionId;
      await this.write({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId },
      });
      this.cancelSent = true;
      this.cancelOnAgentMessageSessionId = null;
    }
  }

  private handleResponse(id: number, message: JsonObject): void {
    const pending = this.pending.get(id);
    if (!pending) {
      this.fail(
        new AcpProtocolError('ACP response id did not match a pending request', { id, message })
      );
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (Object.hasOwn(message, 'error')) {
      pending.reject(
        new AcpProtocolError('ACP request failed', {
          method: pending.method,
          id,
          error: redactUnknown(message.error, this.sensitiveValues),
        })
      );
      return;
    }

    pending.resolve({ jsonrpc: '2.0', id, result: message.result });
  }

  private shouldCancelAfterNotification(notification: JsonRpcNotification): boolean {
    if (!this.cancelOnAgentMessageSessionId || this.cancelSent) return false;
    if (notification.method !== 'session/update') return false;
    const params = notification.params;
    if (!params || params.sessionId !== this.cancelOnAgentMessageSessionId) return false;
    const update = params.update;
    return isJsonObject(update) && update.sessionUpdate === 'agent_message_chunk';
  }

  private async handleClientRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    if (method !== 'session/request_permission') {
      await this.writeJsonRpcError(
        id,
        -32601,
        `Client method not implemented by lifecycle probe: ${method}`
      );
      return;
    }

    let normalized: NormalizedApprovalRequest;
    try {
      normalized = normalizeApprovalRequest(id, params);
    } catch (error) {
      const protocolError =
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP permission request could not be normalized', { method });
      await this.writeJsonRpcError(id, -32602, protocolError.message);
      this.fail(protocolError);
      return;
    }
    const { request, rawSessionId, responseOptions } = normalized;

    this.approvalRequests.push(request);
    this.pendingApprovals.set(id, { request, rawSessionId, responseOptions });

    if (this.approvalHandling.cancelAfterApprovalRequest) {
      await this.respondToApproval(id, request, { outcome: { outcome: 'cancelled' } });
      await this.write({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: rawSessionId },
      });
      this.cancelSent = true;
      return;
    }

    const decision =
      typeof this.approvalHandling.decision === 'function'
        ? this.approvalHandling.decision(request)
        : this.approvalHandling.decision;
    if (!decision) return;

    let response: AcpApprovalResponse;
    try {
      response = approvalResponseFromDecision(request, decision, responseOptions);
    } catch (error) {
      const protocolError =
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP permission decision could not be applied', {
              method: 'session/request_permission',
            });
      await this.writeJsonRpcError(id, -32602, protocolError.message);
      this.fail(protocolError);
      return;
    }

    await this.respondToApproval(id, request, response);
  }

  private async respondToApproval(
    id: JsonRpcId,
    request: AcpApprovalRequest,
    response: AcpApprovalResponse
  ): Promise<void> {
    try {
      await this.write({
        jsonrpc: '2.0',
        id,
        result: response,
      });
    } catch (error) {
      this.approvalWriteClassifications += 1;
      let rejectionReason: AcpApprovalRejectionReason;
      try {
        rejectionReason = await this.approvalRejectionReasonFromWriteError(error);
      } finally {
        this.approvalWriteClassifications -= 1;
      }
      request.state = 'rejected';
      request.rejectionReason = rejectionReason;
      delete request.response;
      this.pendingApprovals.delete(id);
      const protocolError = new AcpProtocolError(
        rejectionReason === 'child_exit'
          ? 'ACP child process exited before approval response write'
          : 'ACP approval response write failed',
        {
          method: 'session/request_permission',
          requestId: id,
          rejectionReason,
          writeError: error instanceof Error ? error.message : String(error),
          approvalRequest: { ...request },
        }
      );
      this.fail(protocolError);
      throw protocolError;
    }
    request.state = 'responded';
    request.response = surfaceApprovalResponse(response);
    this.pendingApprovals.delete(id);
  }

  private async write(message: JsonObject): Promise<void> {
    this.throwIfFailed();
    if (this.hasChildExited()) {
      throw new AcpProtocolError('ACP child process exited before write', {
        ...summarizeOutboundMessage(message),
        approvalRejectionReason: 'child_exit',
      });
    }
    if (
      this.child.stdin.destroyed ||
      this.child.stdin.writableEnded ||
      !this.child.stdin.writable
    ) {
      throw new AcpProtocolError('ACP stdin is not writable', summarizeOutboundMessage(message));
    }
    const payload = `${JSON.stringify(message)}\n`;
    this.activeWrites += 1;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error: Error | null): void => {
          if (settled) return;
          settled = true;
          this.child.stdin.off('error', onError);
          this.child.off('exit', onExit);
          if (error) {
            if (error instanceof AcpProtocolError) {
              reject(error);
              return;
            }
            reject(
              new AcpProtocolError('ACP stdin write failed', {
                ...summarizeOutboundMessage(message),
                approvalRejectionReason: this.hasChildExited() ? 'child_exit' : 'write_failed',
                writeError: error.message,
              })
            );
            return;
          }
          if (this.hasChildExited()) {
            reject(
              new AcpProtocolError('ACP child process exited before write completed', {
                ...summarizeOutboundMessage(message),
                approvalRejectionReason: 'child_exit',
              })
            );
            return;
          }
          if (this.child.stdin.destroyed || this.child.stdin.writableEnded) {
            reject(
              new AcpProtocolError(
                'ACP stdin closed before write completed',
                summarizeOutboundMessage(message)
              )
            );
            return;
          }
          resolve();
        };
        const onError = (error: Error): void => settle(error);
        const onExit = (): void => {
          settle(
            new AcpProtocolError('ACP child process exited before write completed', {
              ...summarizeOutboundMessage(message),
              approvalRejectionReason: 'child_exit',
            })
          );
        };
        this.child.stdin.once('error', onError);
        this.child.once('exit', onExit);
        try {
          this.child.stdin.write(payload, error => settle(error ?? null));
        } catch (error) {
          settle(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } finally {
      this.activeWrites -= 1;
    }
    this.frames.push({ direction: 'client_to_agent', message });
  }

  private hasChildExited(): boolean {
    return this.exited || this.child.exitCode !== null || this.child.signalCode !== null;
  }

  private async approvalRejectionReasonFromWriteError(
    error: unknown
  ): Promise<AcpApprovalRejectionReason> {
    if (
      error instanceof AcpProtocolError &&
      error.details.approvalRejectionReason === 'child_exit'
    ) {
      return 'child_exit';
    }

    if (this.hasChildExited()) return 'child_exit';

    await Promise.race([
      this.exitPromise.then(() => undefined),
      new Promise<void>(resolve => {
        setTimeout(resolve, APPROVAL_WRITE_EXIT_GRACE_MS);
      }),
    ]);

    return this.hasChildExited() ? 'child_exit' : 'write_failed';
  }

  private fail(error: AcpProtocolError): void {
    if (this.protocolFailure) return;
    const redactedDetails = redactJsonObject(error.details, this.sensitiveValues);
    this.protocolFailure = new AcpProtocolError(error.message, redactedDetails);
    this.rejectPendingApprovals('transport_disposed', false);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError(error.message, {
          ...redactedDetails,
          method:
            typeof redactedDetails.method === 'string' ? redactedDetails.method : pending.method,
          id,
        })
      );
    }
    this.pending.clear();
    this.child.kill('SIGTERM');
  }

  private failPendingOnExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.protocolFailure) return;
    const pendingApprovals = this.rejectPendingApprovals('child_exit', false);
    if (this.pending.size === 0) return;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError('ACP child process exited before response', {
          method: pending.method,
          id,
          code,
          signal,
          stderrBytes: Buffer.byteLength(this.stderr, 'utf8'),
          pendingApprovals,
        })
      );
    }
    this.pending.clear();
  }

  private throwIfFailed(): void {
    if (this.protocolFailure) throw this.protocolFailure;
  }

  private async writeJsonRpcError(id: JsonRpcId, code: number, message: string): Promise<void> {
    await this.write({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    });
  }

  private rejectPendingApprovals(
    reason: AcpApprovalRejectionReason,
    notifyAgent: boolean
  ): AcpApprovalRequest[] {
    const rejected: AcpApprovalRequest[] = [];
    for (const [id, pending] of this.pendingApprovals) {
      pending.request.state = 'rejected';
      pending.request.rejectionReason = reason;
      rejected.push({ ...pending.request });
      if (notifyAgent && !this.exited) {
        void this.tryWriteJsonRpcError(id, -32000, `ACP approval request rejected: ${reason}`);
      }
    }
    this.pendingApprovals.clear();
    return rejected;
  }

  private async tryWriteJsonRpcError(id: JsonRpcId, code: number, message: string): Promise<void> {
    try {
      await this.writeJsonRpcError(id, code, message);
    } catch {
      // Best-effort cleanup: the original timeout/exit/dispose error is reported to the caller.
    }
  }

  private failOnResidualStdoutBuffer(): void {
    if (this.protocolFailure || this.stdoutBuffer.trim() === '') return;
    const line = this.stdoutBuffer.replace(/\r$/, '');
    this.stdoutBuffer = '';
    this.fail(new AcpProtocolError('ACP stdout ended with an unterminated line', { line }));
  }
}

function redactJsonObject(value: JsonObject, sensitiveValues: readonly string[]): JsonObject {
  const redacted = redactUnknown(value, sensitiveValues);
  return isJsonObject(redacted) ? redacted : {};
}

function redactUnknown(value: unknown, sensitiveValues: readonly string[]): unknown {
  if (typeof value === 'string') return redactSensitiveString(value, sensitiveValues);
  if (Array.isArray(value)) {
    return value.map(item => redactUnknown(item, sensitiveValues));
  }
  if (!isJsonObject(value)) return value;

  const redacted: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key)
      ? REDACTED_ACP_VALUE
      : redactUnknown(child, sensitiveValues);
  }
  return redacted;
}

function redactSensitiveString(value: string, sensitiveValues: readonly string[]): string {
  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue === '') continue;
    redacted = redacted.split(sensitiveValue).join(REDACTED_ACP_VALUE);
  }
  return redacted;
}

function normalizeNotification(message: JsonObject, method: string): JsonRpcNotification {
  const params = message.params;
  if (params !== undefined && !isJsonObject(params)) {
    throw new AcpProtocolError('ACP notification params must be an object when present', {
      method,
      params,
    });
  }
  return params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
}

function requireInitializeResponse(
  message: JsonRpcSuccess<unknown>
): JsonRpcSuccess<AcpInitializeResult> {
  const result = requireObject(message.result, 'initialize result');
  const agentInfo = requireObject(result.agentInfo, 'initialize agentInfo');
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      protocolVersion: requireNumber(result.protocolVersion, 'initialize protocolVersion'),
      agentCapabilities: requireObject(result.agentCapabilities, 'initialize agentCapabilities'),
      agentInfo: {
        name: requireString(agentInfo.name, 'initialize agentInfo.name'),
        title: optionalString(agentInfo.title, 'initialize agentInfo.title'),
        version: optionalString(agentInfo.version, 'initialize agentInfo.version'),
      },
      authMethods: requireArray(result.authMethods, 'initialize authMethods'),
    },
  };
}

// Extracted approval parsing and helpers to services/acp/permission-service.ts
// Extracted approval helpers: see services/acp/permission-service.ts
 from './acp-event-stream.js';
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
  DEFAULT_TIMEOUT_MS,
  EXIT_TIMEOUT_MS,
  STDERR_LIMIT_BYTES,
  APPROVAL_STRING_LIMIT_BYTES,
  APPROVAL_ARRAY_LIMIT_ITEMS,
  APPROVAL_OBJECT_LIMIT_KEYS,
  APPROVAL_WRITE_EXIT_GRACE_MS,
  REDACTED_ACP_VALUE,
  BYO_LLM_PROVIDER_ENV_KEYS,
} from './acp-lifecycle/acp-lifecycle-types.js';

import type {
  AcpModelProvider,
  AcpPermissionOptionKind,
  AcpApprovalState,
  AcpApprovalRejectionReason,
  Platform,
  JsonObject,
  JsonRpcId,
  AcpAgentInfo,
  AcpInitializeResult,
  AcpNewSessionResult,
  AcpPromptResult,
  JsonRpcSuccess,
  JsonRpcNotification,
  AcpPermissionOption,
  AcpApprovalToolCall,
  AcpSelectedApprovalOutcome,
  AcpCancelledApprovalOutcome,
  AcpApprovalOutcome,
  AcpApprovalResponse,
  AcpApprovalDecision,
  AcpApprovalRequest,
  AcpLifecycleProbeOptions,
  AcpModelPassthroughSummary,
  AcpLifecycleProbeResult,
  PendingRequest,
  AcpModelPassthrough,
  PendingApprovalRequest,
  NormalizedApprovalRequest,
  ApprovalHandlingOptions,
} from './acp-lifecycle/acp-lifecycle-types.js';
// Re-export types/constants so the public surface of this module is unchanged
export {
  DEFAULT_TIMEOUT_MS,
  EXIT_TIMEOUT_MS,
  STDERR_LIMIT_BYTES,
  APPROVAL_STRING_LIMIT_BYTES,
  APPROVAL_ARRAY_LIMIT_ITEMS,
  APPROVAL_OBJECT_LIMIT_KEYS,
  APPROVAL_WRITE_EXIT_GRACE_MS,
  REDACTED_ACP_VALUE,
  BYO_LLM_PROVIDER_ENV_KEYS,
} from './acp-lifecycle/acp-lifecycle-types.js';

export type {
  AcpModelProvider,
  AcpPermissionOptionKind,
  AcpApprovalState,
  AcpApprovalRejectionReason,
  Platform,
  JsonObject,
  JsonRpcId,
  AcpAgentInfo,
  AcpInitializeResult,
  AcpNewSessionResult,
  AcpPromptResult,
  JsonRpcSuccess,
  JsonRpcNotification,
  AcpPermissionOption,
  AcpApprovalToolCall,
  AcpSelectedApprovalOutcome,
  AcpCancelledApprovalOutcome,
  AcpApprovalOutcome,
  AcpApprovalResponse,
  AcpApprovalDecision,
  AcpApprovalRequest,
  AcpLifecycleProbeOptions,
  AcpModelPassthroughSummary,
  AcpLifecycleProbeResult,
  PendingRequest,
  AcpModelPassthrough,
  PendingApprovalRequest,
  NormalizedApprovalRequest,
  ApprovalHandlingOptions,
} from './acp-lifecycle/acp-lifecycle-types.js';

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

class NdjsonRpcTransport {
  readonly frames: AcpCapturedFrame[] = [];
  readonly notifications: JsonRpcNotification[] = [];
  readonly approvalRequests: AcpApprovalRequest[] = [];
  stderr = '';
  cancelSent = false;

  private nextId = 1;
  private stdoutBuffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pendingApprovals = new Map<JsonRpcId, PendingApprovalRequest>();
  private protocolFailure: AcpProtocolError | null = null;
  private cancelOnAgentMessageSessionId: string | null = null;
  private exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private exited = false;
  private activeWrites = 0;
  private approvalWriteClassifications = 0;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number,
    private readonly sensitiveValues: readonly string[],
    private readonly approvalHandling: ApprovalHandlingOptions = {}
  ) {
    this.exitPromise = new Promise(resolve => {
      let exitResult: { code: number | null; signal: NodeJS.Signals | null } | undefined;
      child.once('exit', (code, signal) => {
        this.exited = true;
        exitResult = { code, signal };
      });
      child.once('close', (code, signal) => {
        this.exited = true;
        const finalCode = code ?? exitResult?.code ?? null;
        const finalSignal = signal ?? exitResult?.signal ?? null;
        if (this.pendingApprovals.size > 0) {
          this.failPendingOnExit(finalCode, finalSignal);
          this.failOnResidualStdoutBuffer();
        } else {
          this.failOnResidualStdoutBuffer();
          this.failPendingOnExit(finalCode, finalSignal);
        }
        resolve({ code: finalCode, signal: finalSignal });
      });
    });

    child.once('error', error => {
      this.fail(
        new AcpProtocolError('ACP child process failed to start', { message: error.message })
      );
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderr = appendLimited(this.stderr, chunk, STDERR_LIMIT_BYTES);
    });
    child.stdin.on('error', error => {
      const activeWritesAtError = this.activeWrites;
      setImmediate(() => {
        if (activeWritesAtError > 0) return;
        if (this.approvalWriteClassifications > 0) return;
        if (!this.protocolFailure) {
          this.fail(new AcpProtocolError('ACP stdin write failed', { message: error.message }));
        }
      });
    });
  }

  cancelOnNextAgentMessage(sessionId: string): void {
    this.cancelOnAgentMessageSessionId = sessionId;
  }

  async request(method: string, params: JsonObject): Promise<JsonRpcSuccess<unknown>> {
    this.throwIfFailed();
    const id = this.nextId;
    this.nextId += 1;

    const response = new Promise<JsonRpcSuccess<unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const pendingApprovals = this.rejectPendingApprovals('request_timeout', true);
        reject(
          new AcpProtocolError('ACP request timed out', {
            method,
            id,
            timeoutMs: this.timeoutMs,
            pendingApprovals,
          })
        );
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
    });

    try {
      await this.write({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      const protocolError = toAcpProtocolError(error, 'ACP request write failed', { method, id });
      this.fail(protocolError);
      throw protocolError;
    }
    return response;
  }

  async waitForExit(
    timeoutMs: number
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    const exit = await Promise.race([
      this.exitPromise,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) => {
        setTimeout(
          () => reject(new AcpProtocolError('ACP child process did not exit after stdin closed')),
          timeoutMs
        );
      }),
    ]);
    this.throwIfFailed();
    return exit;
  }

  async dispose(): Promise<void> {
    this.failOnResidualStdoutBuffer();
    this.rejectPendingApprovals('transport_disposed', true);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError('ACP transport disposed before response', {
          method: pending.method,
          id,
        })
      );
    }
    this.pending.clear();

    if (!this.exited) {
      if (!this.child.stdin.destroyed) {
        this.child.stdin.end();
      }
      this.child.kill('SIGTERM');
      await Promise.race([
        this.exitPromise,
        new Promise<void>(resolve => {
          setTimeout(resolve, EXIT_TIMEOUT_MS);
        }),
      ]);
      if (!this.exited) {
        this.child.kill('SIGKILL');
        await this.waitForExit(EXIT_TIMEOUT_MS);
      }
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) return;

      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim() === '') continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown JSON parse error';
        this.fail(
          new AcpProtocolError('ACP stdout contained a non-JSON line', {
            line: redactSensitiveString(line, this.sensitiveValues),
            message,
          })
        );
        return;
      }

      void this.handleMessage(parsed).catch(error => {
        this.fail(toAcpProtocolError(error, 'ACP stdout message handling failed'));
      });
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isJsonObject(message)) {
      this.fail(new AcpProtocolError('ACP stdout message was not a JSON object', { message }));
      return;
    }
    this.frames.push({ direction: 'agent_to_client', message });

    const id = message.id;
    if (
      typeof id === 'number' &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))
    ) {
      this.handleResponse(id, message);
      return;
    }

    const method = message.method;
    if (typeof method !== 'string') {
      this.fail(
        new AcpProtocolError('ACP message did not include a method or response id', { message })
      );
      return;
    }

    if (Object.hasOwn(message, 'id')) {
      if (!isJsonRpcId(id)) {
        this.fail(new AcpProtocolError('ACP request id was not a JSON-RPC id', { id, method }));
        return;
      }
      await this.handleClientRequest(id, method, message.params);
      return;
    }

    let notification: JsonRpcNotification;
    try {
      notification = normalizeNotification(message, method);
    } catch (error) {
      const protocolError =
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP notification could not be normalized');
      this.fail(protocolError);
      return;
    }
    this.notifications.push(notification);
    if (this.shouldCancelAfterNotification(notification)) {
      const sessionId = this.cancelOnAgentMessageSessionId;
      await this.write({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId },
      });
      this.cancelSent = true;
      this.cancelOnAgentMessageSessionId = null;
    }
  }

  private handleResponse(id: number, message: JsonObject): void {
    const pending = this.pending.get(id);
    if (!pending) {
      this.fail(
        new AcpProtocolError('ACP response id did not match a pending request', { id, message })
      );
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (Object.hasOwn(message, 'error')) {
      pending.reject(
        new AcpProtocolError('ACP request failed', {
          method: pending.method,
          id,
          error: redactUnknown(message.error, this.sensitiveValues),
        })
      );
      return;
    }

    pending.resolve({ jsonrpc: '2.0', id, result: message.result });
  }

  private shouldCancelAfterNotification(notification: JsonRpcNotification): boolean {
    if (!this.cancelOnAgentMessageSessionId || this.cancelSent) return false;
    if (notification.method !== 'session/update') return false;
    const params = notification.params;
    if (!params || params.sessionId !== this.cancelOnAgentMessageSessionId) return false;
    const update = params.update;
    return isJsonObject(update) && update.sessionUpdate === 'agent_message_chunk';
  }

  private async handleClientRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    if (method !== 'session/request_permission') {
      await this.writeJsonRpcError(
        id,
        -32601,
        `Client method not implemented by lifecycle probe: ${method}`
      );
      return;
    }

    let normalized: NormalizedApprovalRequest;
    try {
      normalized = normalizeApprovalRequest(id, params);
    } catch (error) {
      const protocolError =
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP permission request could not be normalized', { method });
      await this.writeJsonRpcError(id, -32602, protocolError.message);
      this.fail(protocolError);
      return;
    }
    const { request, rawSessionId, responseOptions } = normalized;

    this.approvalRequests.push(request);
    this.pendingApprovals.set(id, { request, rawSessionId, responseOptions });

    if (this.approvalHandling.cancelAfterApprovalRequest) {
      await this.respondToApproval(id, request, { outcome: { outcome: 'cancelled' } });
      await this.write({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: rawSessionId },
      });
      this.cancelSent = true;
      return;
    }

    const decision =
      typeof this.approvalHandling.decision === 'function'
        ? this.approvalHandling.decision(request)
        : this.approvalHandling.decision;
    if (!decision) return;

    let response: AcpApprovalResponse;
    try {
      response = approvalResponseFromDecision(request, decision, responseOptions);
    } catch (error) {
      const protocolError =
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP permission decision could not be applied', {
              method: 'session/request_permission',
            });
      await this.writeJsonRpcError(id, -32602, protocolError.message);
      this.fail(protocolError);
      return;
    }

    await this.respondToApproval(id, request, response);
  }

  private async respondToApproval(
    id: JsonRpcId,
    request: AcpApprovalRequest,
    response: AcpApprovalResponse
  ): Promise<void> {
    try {
      await this.write({
        jsonrpc: '2.0',
        id,
        result: response,
      });
    } catch (error) {
      this.approvalWriteClassifications += 1;
      let rejectionReason: AcpApprovalRejectionReason;
      try {
        rejectionReason = await this.approvalRejectionReasonFromWriteError(error);
      } finally {
        this.approvalWriteClassifications -= 1;
      }
      request.state = 'rejected';
      request.rejectionReason = rejectionReason;
      delete request.response;
      this.pendingApprovals.delete(id);
      const protocolError = new AcpProtocolError(
        rejectionReason === 'child_exit'
          ? 'ACP child process exited before approval response write'
          : 'ACP approval response write failed',
        {
          method: 'session/request_permission',
          requestId: id,
          rejectionReason,
          writeError: error instanceof Error ? error.message : String(error),
          approvalRequest: { ...request },
        }
      );
      this.fail(protocolError);
      throw protocolError;
    }
    request.state = 'responded';
    request.response = surfaceApprovalResponse(response);
    this.pendingApprovals.delete(id);
  }

  private async write(message: JsonObject): Promise<void> {
    this.throwIfFailed();
    if (this.hasChildExited()) {
      throw new AcpProtocolError('ACP child process exited before write', {
        ...summarizeOutboundMessage(message),
        approvalRejectionReason: 'child_exit',
      });
    }
    if (
      this.child.stdin.destroyed ||
      this.child.stdin.writableEnded ||
      !this.child.stdin.writable
    ) {
      throw new AcpProtocolError('ACP stdin is not writable', summarizeOutboundMessage(message));
    }
    const payload = `${JSON.stringify(message)}\n`;
    this.activeWrites += 1;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error: Error | null): void => {
          if (settled) return;
          settled = true;
          this.child.stdin.off('error', onError);
          this.child.off('exit', onExit);
          if (error) {
            if (error instanceof AcpProtocolError) {
              reject(error);
              return;
            }
            reject(
              new AcpProtocolError('ACP stdin write failed', {
                ...summarizeOutboundMessage(message),
                approvalRejectionReason: this.hasChildExited() ? 'child_exit' : 'write_failed',
                writeError: error.message,
              })
            );
            return;
          }
          if (this.hasChildExited()) {
            reject(
              new AcpProtocolError('ACP child process exited before write completed', {
                ...summarizeOutboundMessage(message),
                approvalRejectionReason: 'child_exit',
              })
            );
            return;
          }
          if (this.child.stdin.destroyed || this.child.stdin.writableEnded) {
            reject(
              new AcpProtocolError(
                'ACP stdin closed before write completed',
                summarizeOutboundMessage(message)
              )
            );
            return;
          }
          resolve();
        };
        const onError = (error: Error): void => settle(error);
        const onExit = (): void => {
          settle(
            new AcpProtocolError('ACP child process exited before write completed', {
              ...summarizeOutboundMessage(message),
              approvalRejectionReason: 'child_exit',
            })
          );
        };
        this.child.stdin.once('error', onError);
        this.child.once('exit', onExit);
        try {
          this.child.stdin.write(payload, error => settle(error ?? null));
        } catch (error) {
          settle(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } finally {
      this.activeWrites -= 1;
    }
    this.frames.push({ direction: 'client_to_agent', message });
  }

  private hasChildExited(): boolean {
    return this.exited || this.child.exitCode !== null || this.child.signalCode !== null;
  }

  private async approvalRejectionReasonFromWriteError(
    error: unknown
  ): Promise<AcpApprovalRejectionReason> {
    if (
      error instanceof AcpProtocolError &&
      error.details.approvalRejectionReason === 'child_exit'
    ) {
      return 'child_exit';
    }

    if (this.hasChildExited()) return 'child_exit';

    await Promise.race([
      this.exitPromise.then(() => undefined),
      new Promise<void>(resolve => {
        setTimeout(resolve, APPROVAL_WRITE_EXIT_GRACE_MS);
      }),
    ]);

    return this.hasChildExited() ? 'child_exit' : 'write_failed';
  }

  private fail(error: AcpProtocolError): void {
    if (this.protocolFailure) return;
    const redactedDetails = redactJsonObject(error.details, this.sensitiveValues);
    this.protocolFailure = new AcpProtocolError(error.message, redactedDetails);
    this.rejectPendingApprovals('transport_disposed', false);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError(error.message, {
          ...redactedDetails,
          method:
            typeof redactedDetails.method === 'string' ? redactedDetails.method : pending.method,
          id,
        })
      );
    }
    this.pending.clear();
    this.child.kill('SIGTERM');
  }

  private failPendingOnExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.protocolFailure) return;
    const pendingApprovals = this.rejectPendingApprovals('child_exit', false);
    if (this.pending.size === 0) return;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError('ACP child process exited before response', {
          method: pending.method,
          id,
          code,
          signal,
          stderrBytes: Buffer.byteLength(this.stderr, 'utf8'),
          pendingApprovals,
        })
      );
    }
    this.pending.clear();
  }

  private throwIfFailed(): void {
    if (this.protocolFailure) throw this.protocolFailure;
  }

  private async writeJsonRpcError(id: JsonRpcId, code: number, message: string): Promise<void> {
    await this.write({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    });
  }

  private rejectPendingApprovals(
    reason: AcpApprovalRejectionReason,
    notifyAgent: boolean
  ): AcpApprovalRequest[] {
    const rejected: AcpApprovalRequest[] = [];
    for (const [id, pending] of this.pendingApprovals) {
      pending.request.state = 'rejected';
      pending.request.rejectionReason = reason;
      rejected.push({ ...pending.request });
      if (notifyAgent && !this.exited) {
        void this.tryWriteJsonRpcError(id, -32000, `ACP approval request rejected: ${reason}`);
      }
    }
    this.pendingApprovals.clear();
    return rejected;
  }

  private async tryWriteJsonRpcError(id: JsonRpcId, code: number, message: string): Promise<void> {
    try {
      await this.writeJsonRpcError(id, code, message);
    } catch {
      // Best-effort cleanup: the original timeout/exit/dispose error is reported to the caller.
    }
  }

  private failOnResidualStdoutBuffer(): void {
    if (this.protocolFailure || this.stdoutBuffer.trim() === '') return;
    const line = this.stdoutBuffer.replace(/\r$/, '');
    this.stdoutBuffer = '';
    this.fail(new AcpProtocolError('ACP stdout ended with an unterminated line', { line }));
  }
}

function redactJsonObject(value: JsonObject, sensitiveValues: readonly string[]): JsonObject {
  const redacted = redactUnknown(value, sensitiveValues);
  return isJsonObject(redacted) ? redacted : {};
}

function redactUnknown(value: unknown, sensitiveValues: readonly string[]): unknown {
  if (typeof value === 'string') return redactSensitiveString(value, sensitiveValues);
  if (Array.isArray(value)) {
    return value.map(item => redactUnknown(item, sensitiveValues));
  }
  if (!isJsonObject(value)) return value;

  const redacted: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key)
      ? REDACTED_ACP_VALUE
      : redactUnknown(child, sensitiveValues);
  }
  return redacted;
}

function redactSensitiveString(value: string, sensitiveValues: readonly string[]): string {
  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue === '') continue;
    redacted = redacted.split(sensitiveValue).join(REDACTED_ACP_VALUE);
  }
  return redacted;
}

function normalizeNotification(message: JsonObject, method: string): JsonRpcNotification {
  const params = message.params;
  if (params !== undefined && !isJsonObject(params)) {
    throw new AcpProtocolError('ACP notification params must be an object when present', {
      method,
      params,
    });
  }
  return params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
}

function requireInitializeResponse(
  message: JsonRpcSuccess<unknown>
): JsonRpcSuccess<AcpInitializeResult> {
  const result = requireObject(message.result, 'initialize result');
  const agentInfo = requireObject(result.agentInfo, 'initialize agentInfo');
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      protocolVersion: requireNumber(result.protocolVersion, 'initialize protocolVersion'),
      agentCapabilities: requireObject(result.agentCapabilities, 'initialize agentCapabilities'),
      agentInfo: {
        name: requireString(agentInfo.name, 'initialize agentInfo.name'),
        title: optionalString(agentInfo.title, 'initialize agentInfo.title'),
        version: optionalString(agentInfo.version, 'initialize agentInfo.version'),
      },
      authMethods: requireArray(result.authMethods, 'initialize authMethods'),
    },
  };
}

// Extracted approval parsing and helpers to services/acp/permission-service.ts

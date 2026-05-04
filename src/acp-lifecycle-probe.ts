import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  type AcpCapturedFrame,
  type AcpNormalizedEvent,
  normalizeAcpFrames,
} from './acp-event-stream.js';
import { buildAcpResolveEnv, buildAcpSpawnEnv } from './acp-spawn-env.js';

export type { AcpCapturedFrame, AcpNormalizedEvent } from './acp-event-stream.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const EXIT_TIMEOUT_MS = 2_000;
const STDERR_LIMIT_BYTES = 64 * 1024;

export type AcpCommandSource = 'explicit' | 'AEGIS_ACP_BIN' | 'local-package-bin' | 'npm-exec';
export type AcpModelProvider =
  | 'anthropic'
  | 'glm'
  | 'openrouter'
  | 'lm-studio'
  | 'ollama'
  | 'azure-openai';

export const REDACTED_ACP_VALUE = '[REDACTED]';

type Platform = NodeJS.Platform;
export type JsonObject = Record<string, unknown>;

type FileExists = (candidate: string) => boolean;

export interface ResolvedAcpCommand {
  command: string;
  args: string[];
  source: AcpCommandSource;
}

export interface ResolveAcpCommandOptions {
  explicitCommand?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: Platform;
  fileExists?: FileExists;
}

export interface AcpAgentInfo {
  name: string;
  title?: string;
  version?: string;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities: JsonObject;
  agentInfo: AcpAgentInfo;
  authMethods: unknown[];
}

export interface AcpNewSessionResult {
  sessionId: string;
}

export interface AcpPromptResult {
  stopReason: string;
}

export interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: number;
  result: T;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: JsonObject;
}

export interface AcpLifecycleProbeOptions {
  resolvedCommand?: ResolvedAcpCommand;
  command?: string;
  args?: readonly string[];
  cwd: string;
  sessionCwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  prompt?: string;
  model?: string;
  modelProvider?: string;
  providerEnv?: Record<string, string | undefined>;
  resumeSession?: boolean;
  closeSession?: boolean;
  cancelAfterFirstUpdate?: boolean;
  clientCapabilities?: JsonObject;
}

export interface AcpModelPassthroughSummary {
  provider?: AcpModelProvider;
  model?: string;
  env: Record<string, string>;
  envKeys: string[];
}

export interface AcpLifecycleProbeResult {
  command: ResolvedAcpCommand;
  initialize: JsonRpcSuccess<AcpInitializeResult>;
  newSession: JsonRpcSuccess<AcpNewSessionResult>;
  sessionId: string;
  resume?: JsonRpcSuccess<JsonObject>;
  prompt?: JsonRpcSuccess<AcpPromptResult>;
  close?: JsonRpcSuccess<JsonObject>;
  frames: AcpCapturedFrame[];
  normalizedEvents: AcpNormalizedEvent[];
  notifications: JsonRpcNotification[];
  stderr: string;
  modelPassthrough: AcpModelPassthroughSummary;
  cancelSent: boolean;
  exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
  };
}

interface PendingRequest {
  method: string;
  resolve: (message: JsonRpcSuccess<unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface AcpModelPassthrough {
  summary: AcpModelPassthroughSummary;
  env: Record<string, string>;
  sessionMeta?: JsonObject;
  sensitiveValues: string[];
}

export class AcpProtocolError extends Error {
  readonly details: JsonObject;

  constructor(message: string, details: JsonObject = {}) {
    super(message);
    this.name = 'AcpProtocolError';
    this.details = details;
  }
}

export function resolveAcpCommand(options: ResolveAcpCommandOptions = {}): ResolvedAcpCommand {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const fileExists = options.fileExists ?? existsSync;
  const pathTools = platform === 'win32' ? path.win32 : path.posix;

  if (options.explicitCommand && options.explicitCommand.trim() !== '') {
    return toSpawnableCommand(options.explicitCommand, [], 'explicit', platform);
  }

  const envCommand = env.AEGIS_ACP_BIN;
  if (envCommand && envCommand.trim() !== '') {
    return toSpawnableCommand(envCommand, [], 'AEGIS_ACP_BIN', platform);
  }

  const packageBinName = platform === 'win32' ? 'claude-agent-acp.cmd' : 'claude-agent-acp';
  const packageBin = pathTools.join(cwd, 'node_modules', '.bin', packageBinName);
  if (fileExists(packageBin)) {
    return toSpawnableCommand(packageBin, [], 'local-package-bin', platform);
  }

  return toSpawnableCommand(
    platform === 'win32' ? 'npm.cmd' : 'npm',
    ['exec', '--yes', '--package=@agentclientprotocol/claude-agent-acp', '--', 'claude-agent-acp'],
    'npm-exec',
    platform
  );
}

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

function toSpawnableCommand(
  command: string,
  args: string[],
  source: AcpCommandSource,
  platform: Platform
): ResolvedAcpCommand {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args, source };
  }

  return {
    command: 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      [quoteWindowsCmdArg(command), ...args.map(quoteWindowsCmdArg)].join(' '),
    ],
    source,
  };
}

function quoteWindowsCmdArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `"${value.replace(/(["^&|<>%])/g, '^$1')}"`;
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
    resolvedCommand = resolveAcpCommand({
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

  const transport = new NdjsonRpcTransport(child, timeoutMs, modelPassthrough.sensitiveValues);
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
  stderr = '';
  cancelSent = false;

  private nextId = 1;
  private stdoutBuffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private protocolFailure: AcpProtocolError | null = null;
  private cancelOnAgentMessageSessionId: string | null = null;
  private exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private exited = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number,
    private readonly sensitiveValues: readonly string[]
  ) {
    this.exitPromise = new Promise(resolve => {
      child.once('exit', (code, signal) => {
        this.exited = true;
        this.failPendingOnExit(code, signal);
        resolve({ code, signal });
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
        reject(
          new AcpProtocolError('ACP request timed out', { method, id, timeoutMs: this.timeoutMs })
        );
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
    });

    this.write({ jsonrpc: '2.0', id, method, params });
    return response;
  }

  async waitForExit(
    timeoutMs: number
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return Promise.race([
      this.exitPromise,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((_, reject) => {
        setTimeout(
          () => reject(new AcpProtocolError('ACP child process did not exit after stdin closed')),
          timeoutMs
        );
      }),
    ]);
  }

  async dispose(): Promise<void> {
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

      this.handleMessage(parsed);
    }
  }

  private handleMessage(message: unknown): void {
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

    if (typeof id === 'number') {
      this.write({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Client method not implemented by lifecycle probe: ${method}`,
        },
      });
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
      this.write({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: this.cancelOnAgentMessageSessionId },
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

  private write(message: JsonObject): void {
    this.throwIfFailed();
    if (this.child.stdin.destroyed || !this.child.stdin.writable) {
      throw new AcpProtocolError('ACP stdin is not writable', { message });
    }
    this.frames.push({ direction: 'client_to_agent', message });
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private fail(error: AcpProtocolError): void {
    if (this.protocolFailure) return;
    const redactedDetails = redactJsonObject(error.details, this.sensitiveValues);
    this.protocolFailure = new AcpProtocolError(error.message, redactedDetails);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError(error.message, { ...redactedDetails, method: pending.method, id })
      );
    }
    this.pending.clear();
    this.child.kill('SIGTERM');
  }

  private failPendingOnExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.protocolFailure || this.pending.size === 0) return;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError('ACP child process exited before response', {
          method: pending.method,
          id,
          code,
          signal,
          stderrBytes: Buffer.byteLength(this.stderr, 'utf8'),
        })
      );
    }
    this.pending.clear();
  }

  private throwIfFailed(): void {
    if (this.protocolFailure) throw this.protocolFailure;
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

function requireNewSessionResponse(
  message: JsonRpcSuccess<unknown>
): JsonRpcSuccess<AcpNewSessionResult> {
  const result = requireObject(message.result, 'session/new result');
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      sessionId: requireString(result.sessionId, 'session/new sessionId'),
    },
  };
}

function requirePromptResponse(message: JsonRpcSuccess<unknown>): JsonRpcSuccess<AcpPromptResult> {
  const result = requireObject(message.result, 'session/prompt result');
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      stopReason: requireString(result.stopReason, 'session/prompt stopReason'),
    },
  };
}

function requireObjectResponse(message: JsonRpcSuccess<unknown>): JsonRpcSuccess<JsonObject> {
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: requireObject(message.result, 'JSON-RPC result'),
  };
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new AcpProtocolError(`${label} must be an object`, { value });
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AcpProtocolError(`${label} must be an array`, { value });
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AcpProtocolError(`${label} must be a string`, { value });
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new AcpProtocolError(`${label} must be a number`, { value });
  }
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appendLimited(current: string, chunk: string, limitBytes: number): string {
  const combined = Buffer.from(`${current}${chunk}`, 'utf8');
  if (combined.length <= limitBytes) return combined.toString('utf8');

  let start = combined.length - limitBytes;
  while (start < combined.length && (combined[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return combined.subarray(start).toString('utf8');
}

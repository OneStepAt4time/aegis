import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  AcpProtocolError,
  resolveAcpCommand,
  type JsonRpcNotification,
  type JsonRpcSuccess,
  type ResolvedAcpCommand,
} from './acp-lifecycle-probe.js';
import { buildAcpResolveEnv, buildAcpSpawnEnv } from './acp-spawn-env.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const EXIT_TIMEOUT_MS = 2_000;
const STDERR_LIMIT_BYTES = 64 * 1024;
const TERMINAL_EXTENSION_PARITY_AREA = 'terminal-extension';

type JsonObject = Record<string, unknown>;

export interface TerminalExtensionCapabilities {
  inputEcho: true;
  resize: true;
  reconnect: true;
  debugOutput: true;
}

export interface AcpTerminalResize {
  columns: number;
  rows: number;
}

export interface AcpTerminalExtensionProbeOptions {
  resolvedCommand?: ResolvedAcpCommand;
  command?: string;
  args?: readonly string[];
  cwd: string;
  sessionCwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  input?: string;
  resize?: AcpTerminalResize;
}

export interface AcpTerminalInputEcho {
  terminalId: string;
  data: string;
}

export interface AcpTerminalResizeEvent {
  terminalId: string;
  columns: number;
  rows: number;
}

export interface AcpTerminalReconnectSnapshot {
  terminalId: string;
  replayedOutput: string;
  columns: number;
  rows: number;
}

export interface AcpTerminalDebugOutput {
  terminalId: string;
  level: string;
  message: string;
}

export interface AcpTerminalExtensionProbeResult {
  command: ResolvedAcpCommand;
  capabilities: TerminalExtensionCapabilities;
  sessionId: string;
  terminalId: string;
  inputEcho: AcpTerminalInputEcho;
  resize: AcpTerminalResizeEvent;
  reconnect: AcpTerminalReconnectSnapshot;
  debug: AcpTerminalDebugOutput[];
  notifications: JsonRpcNotification[];
  stderr: string;
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

interface TerminalEventWaiter {
  expectedKind: TerminalExtensionEvent['kind'];
  resolve: (event: TerminalExtensionEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface DebugWaiter {
  resolve: (event: AcpTerminalDebugOutput) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface InputEchoEvent extends AcpTerminalInputEcho {
  kind: 'input_echo';
}

interface ResizeEvent extends AcpTerminalResizeEvent {
  kind: 'resize';
}

interface ReconnectSnapshotEvent extends AcpTerminalReconnectSnapshot {
  kind: 'reconnect_snapshot';
}

type TerminalExtensionEvent = InputEchoEvent | ResizeEvent | ReconnectSnapshotEvent;

export async function runAcpTerminalExtensionProbe(
  options: AcpTerminalExtensionProbeOptions
): Promise<AcpTerminalExtensionProbeResult> {
  const resolvedCommand = resolveProbeCommand(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn(resolvedCommand.command, resolvedCommand.args, {
    cwd: options.cwd,
    env: buildAcpSpawnEnv(options.env),
    stdio: 'pipe',
    windowsHide: true,
  });
  const transport = new TerminalExtensionTransport(child, timeoutMs);
  const input = options.input ?? 'aegis terminal input\n';
  const resize = options.resize ?? { columns: 120, rows: 32 };

  try {
    const initialize = requireObjectResponse(
      await transport.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          terminalExtension: true,
        },
        clientInfo: {
          name: 'aegis-acp-terminal-extension-probe',
          title: 'Aegis ACP Terminal Extension Probe',
          version: '0.0.0-spike',
        },
      }),
      'initialize result'
    );
    const capabilities = requireTerminalExtensionCapabilities(initialize.result);

    const newSession = requireObjectResponse(
      await transport.request('session/new', {
        cwd: options.sessionCwd ?? options.cwd,
        mcpServers: [],
      }),
      'session/new result'
    );
    const sessionId = requireString(newSession.result.sessionId, 'session/new sessionId');

    const open = requireObjectResponse(
      await transport.request('terminal/open', {
        sessionId,
      }),
      'terminal/open result'
    );
    const terminalId = requireString(open.result.terminalId, 'terminal/open terminalId');
    transport.setTerminalContext(sessionId, terminalId);

    const inputEchoPromise = transport.waitForTerminalEvent('input_echo');
    await transport.request('terminal/input', {
      sessionId,
      terminalId,
      data: input,
    });
    const inputEcho = requireInputEchoEvent(await inputEchoPromise, input);
    const debugPromise = transport.waitForDebugOutput();

    const resizePromise = transport.waitForTerminalEvent('resize');
    await transport.request('terminal/resize', {
      sessionId,
      terminalId,
      columns: resize.columns,
      rows: resize.rows,
    });
    const resizeEvent = requireResizeEvent(await resizePromise, resize);

    const reconnectPromise = transport.waitForTerminalEvent('reconnect_snapshot');
    await transport.request('terminal/resubscribe', {
      sessionId,
      terminalId,
    });
    const reconnect = requireReconnectSnapshotEvent(await reconnectPromise, {
      input,
      resize,
    });
    const debug = await debugPromise;

    await transport.request('terminal/close', {
      sessionId,
      terminalId,
    });
    await transport.request('session/close', {
      sessionId,
    });
    child.stdin.end();
    const exit = await transport.waitForExit(EXIT_TIMEOUT_MS);

    return {
      command: resolvedCommand,
      capabilities,
      sessionId,
      terminalId,
      inputEcho,
      resize: resizeEvent,
      reconnect,
      debug: [debug],
      notifications: transport.notifications,
      stderr: transport.stderr,
      exit,
    };
  } finally {
    await transport.dispose();
  }
}

function resolveProbeCommand(options: AcpTerminalExtensionProbeOptions): ResolvedAcpCommand {
  if (options.resolvedCommand) return options.resolvedCommand;
  if (options.command) {
    return {
      command: options.command,
      args: [...(options.args ?? [])],
      source: 'explicit',
    };
  }
  return resolveAcpCommand({
    cwd: options.cwd,
    env: buildAcpResolveEnv(options.env),
  });
}

class TerminalExtensionTransport {
  readonly notifications: JsonRpcNotification[] = [];
  stderr = '';

  private nextId = 1;
  private stdoutBuffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private readonly terminalEventWaiters: TerminalEventWaiter[] = [];
  private readonly debugWaiters: DebugWaiter[] = [];
  private readonly terminalEvents: TerminalExtensionEvent[] = [];
  private readonly debugEvents: AcpTerminalDebugOutput[] = [];
  private protocolFailure: AcpProtocolError | null = null;
  private exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private exited = false;
  private expectedSessionId: string | null = null;
  private expectedTerminalId: string | null = null;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number
  ) {
    this.exitPromise = new Promise(resolve => {
      child.once('exit', (code, signal) => {
        this.exited = true;
        this.failTerminalWaitersOnExit(code, signal);
        this.failDebugWaitersOnExit(code, signal);
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

  setTerminalContext(sessionId: string, terminalId: string): void {
    this.expectedSessionId = sessionId;
    this.expectedTerminalId = terminalId;
  }

  waitForTerminalEvent(
    expectedKind: TerminalExtensionEvent['kind']
  ): Promise<TerminalExtensionEvent> {
    const existing = this.terminalEvents.find(event => event.kind === expectedKind);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeTerminalEventWaiter(waiter);
        reject(
          new AcpProtocolError('ACP terminal event timed out', {
            parityArea: TERMINAL_EXTENSION_PARITY_AREA,
            expectedKind,
            timeoutMs: this.timeoutMs,
          })
        );
      }, this.timeoutMs);
      const waiter: TerminalEventWaiter = { expectedKind, resolve, reject, timer };
      this.terminalEventWaiters.push(waiter);
    });
  }

  waitForDebugOutput(): Promise<AcpTerminalDebugOutput> {
    const existing = this.debugEvents.at(0);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeDebugWaiter(waiter);
        reject(
          new AcpProtocolError('ACP terminal debug output timed out', {
            parityArea: TERMINAL_EXTENSION_PARITY_AREA,
            timeoutMs: this.timeoutMs,
          })
        );
      }, this.timeoutMs);
      const waiter: DebugWaiter = { resolve, reject, timer };
      this.debugWaiters.push(waiter);
    });
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
    this.rejectTerminalWaiters(
      new AcpProtocolError('ACP transport disposed before terminal event', {
        parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      })
    );
    this.rejectDebugWaiters(
      new AcpProtocolError('ACP transport disposed before terminal debug output', {
        parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      })
    );

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
        this.fail(new AcpProtocolError('ACP stdout contained a non-JSON line', { line, message }));
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
          message: `Client method not implemented by terminal extension probe: ${method}`,
        },
      });
      return;
    }

    let notification: JsonRpcNotification;
    try {
      notification = normalizeNotification(message, method);
    } catch (error) {
      this.fail(
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP notification could not be normalized')
      );
      return;
    }
    this.notifications.push(notification);
    if (method === 'terminal/event') {
      this.handleTerminalEvent(notification);
      return;
    }
    if (method === 'terminal/debug') {
      this.handleDebugOutput(notification);
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
          error: message.error,
        })
      );
      return;
    }

    pending.resolve({ jsonrpc: '2.0', id, result: message.result });
  }

  private handleTerminalEvent(notification: JsonRpcNotification): void {
    let event: TerminalExtensionEvent;
    try {
      event = normalizeTerminalEvent(notification, this.expectedSessionId, this.expectedTerminalId);
    } catch (error) {
      if (
        error instanceof AcpProtocolError &&
        error.message === 'ACP terminal event was malformed'
      ) {
        this.failTerminalStream(error);
        return;
      }
      this.failTerminalStream(
        new AcpProtocolError('ACP terminal event was malformed', {
          parityArea: TERMINAL_EXTENSION_PARITY_AREA,
          expectedKind: this.terminalEventWaiters.at(0)?.expectedKind ?? 'unknown',
          cause: error instanceof Error ? error.message : String(error),
        })
      );
      return;
    }

    this.terminalEvents.push(event);
    for (const waiter of [...this.terminalEventWaiters]) {
      if (waiter.expectedKind !== event.kind) continue;
      clearTimeout(waiter.timer);
      this.removeTerminalEventWaiter(waiter);
      waiter.resolve(event);
    }
  }

  private handleDebugOutput(notification: JsonRpcNotification): void {
    let event: AcpTerminalDebugOutput;
    try {
      event = normalizeDebugOutput(notification, this.expectedSessionId, this.expectedTerminalId);
    } catch (error) {
      this.failTerminalStream(
        error instanceof AcpProtocolError
          ? error
          : new AcpProtocolError('ACP terminal debug output was malformed', {
              parityArea: TERMINAL_EXTENSION_PARITY_AREA,
            })
      );
      return;
    }

    this.debugEvents.push(event);
    for (const waiter of [...this.debugWaiters]) {
      clearTimeout(waiter.timer);
      this.removeDebugWaiter(waiter);
      waiter.resolve(event);
    }
  }

  private write(message: JsonObject): void {
    this.throwIfFailed();
    if (this.child.stdin.destroyed || !this.child.stdin.writable) {
      throw new AcpProtocolError('ACP stdin is not writable', { message });
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private fail(error: AcpProtocolError): void {
    if (this.protocolFailure) return;
    this.protocolFailure = error;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new AcpProtocolError(error.message, { ...error.details, method: pending.method, id })
      );
    }
    this.pending.clear();
    this.rejectTerminalWaiters(error);
    this.rejectDebugWaiters(error);
    this.child.kill('SIGTERM');
  }

  private failTerminalStream(error: AcpProtocolError): void {
    this.fail(error);
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

  private failTerminalWaitersOnExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.protocolFailure || this.terminalEventWaiters.length === 0) return;
    const waiters = [...this.terminalEventWaiters];
    this.terminalEventWaiters.length = 0;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new AcpProtocolError('ACP child process exited during terminal stream', {
          parityArea: TERMINAL_EXTENSION_PARITY_AREA,
          expectedKind: waiter.expectedKind,
          code,
          signal,
          stderrBytes: Buffer.byteLength(this.stderr, 'utf8'),
        })
      );
    }
  }

  private failDebugWaitersOnExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.protocolFailure || this.debugWaiters.length === 0) return;
    const waiters = [...this.debugWaiters];
    this.debugWaiters.length = 0;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new AcpProtocolError('ACP child process exited before terminal debug output', {
          parityArea: TERMINAL_EXTENSION_PARITY_AREA,
          code,
          signal,
          stderrBytes: Buffer.byteLength(this.stderr, 'utf8'),
        })
      );
    }
  }

  private rejectTerminalWaiters(error: AcpProtocolError): void {
    const waiters = [...this.terminalEventWaiters];
    this.terminalEventWaiters.length = 0;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private rejectDebugWaiters(error: AcpProtocolError): void {
    const waiters = [...this.debugWaiters];
    this.debugWaiters.length = 0;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private removeTerminalEventWaiter(waiter: TerminalEventWaiter): void {
    const index = this.terminalEventWaiters.indexOf(waiter);
    if (index !== -1) {
      this.terminalEventWaiters.splice(index, 1);
    }
  }

  private removeDebugWaiter(waiter: DebugWaiter): void {
    const index = this.debugWaiters.indexOf(waiter);
    if (index !== -1) {
      this.debugWaiters.splice(index, 1);
    }
  }

  private throwIfFailed(): void {
    if (this.protocolFailure) throw this.protocolFailure;
  }
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

function normalizeTerminalEvent(
  notification: JsonRpcNotification,
  expectedSessionId: string | null,
  expectedTerminalId: string | null
): TerminalExtensionEvent {
  const params = requireObject(notification.params, 'terminal/event params');
  requireExpectedString(
    params.sessionId,
    'terminal/event sessionId',
    expectedSessionId,
    'expectedSessionId',
    'actualSessionId'
  );
  const event = requireObject(params.event, 'terminal/event event');
  const kind = requireString(event.kind, 'terminal/event kind');
  requireExpectedString(
    event.terminalId,
    'terminal/event terminalId',
    expectedTerminalId,
    'expectedTerminalId',
    'actualTerminalId'
  );
  if (kind === 'input_echo') {
    return {
      kind,
      terminalId: requireString(event.terminalId, 'terminal/event terminalId'),
      data: requireString(event.data, 'terminal/event data'),
    };
  }
  if (kind === 'resize') {
    return {
      kind,
      terminalId: requireString(event.terminalId, 'terminal/event terminalId'),
      columns: requireNumber(event.columns, 'terminal/event columns'),
      rows: requireNumber(event.rows, 'terminal/event rows'),
    };
  }
  if (kind === 'reconnect_snapshot') {
    return {
      kind,
      terminalId: requireString(event.terminalId, 'terminal/event terminalId'),
      replayedOutput: requireString(event.replayedOutput, 'terminal/event replayedOutput'),
      columns: requireNumber(event.columns, 'terminal/event columns'),
      rows: requireNumber(event.rows, 'terminal/event rows'),
    };
  }
  throw new AcpProtocolError('ACP terminal event was malformed', {
    parityArea: TERMINAL_EXTENSION_PARITY_AREA,
    expectedKind: 'input_echo',
    actualKind: kind,
  });
}

function normalizeDebugOutput(
  notification: JsonRpcNotification,
  expectedSessionId: string | null,
  expectedTerminalId: string | null
): AcpTerminalDebugOutput {
  const params = requireObject(notification.params, 'terminal/debug params');
  requireExpectedString(
    params.sessionId,
    'terminal/debug sessionId',
    expectedSessionId,
    'expectedSessionId',
    'actualSessionId',
    'ACP terminal debug output was malformed'
  );
  requireExpectedString(
    params.terminalId,
    'terminal/debug terminalId',
    expectedTerminalId,
    'expectedTerminalId',
    'actualTerminalId',
    'ACP terminal debug output was malformed'
  );
  return {
    terminalId: requireString(params.terminalId, 'terminal/debug terminalId'),
    level: requireString(params.level, 'terminal/debug level'),
    message: requireString(params.message, 'terminal/debug message'),
  };
}

function requireTerminalExtensionCapabilities(result: JsonObject): TerminalExtensionCapabilities {
  const agentCapabilities = requireObject(result.agentCapabilities, 'initialize agentCapabilities');
  const terminalExtension = agentCapabilities.terminalExtension;
  if (!isJsonObject(terminalExtension)) {
    throw new AcpProtocolError('ACP terminal extension is not supported', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      agentCapabilities,
    });
  }
  if (
    terminalExtension.inputEcho !== true ||
    terminalExtension.resize !== true ||
    terminalExtension.reconnect !== true ||
    terminalExtension.debugOutput !== true
  ) {
    throw new AcpProtocolError('ACP terminal extension is not supported', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      terminalExtension,
    });
  }
  return {
    inputEcho: true,
    resize: true,
    reconnect: true,
    debugOutput: true,
  };
}

function requireInputEchoEvent(
  event: TerminalExtensionEvent,
  expectedData: string
): AcpTerminalInputEcho {
  if (event.kind !== 'input_echo') {
    throw new AcpProtocolError('ACP terminal event was malformed', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      expectedKind: 'input_echo',
      actualKind: event.kind,
    });
  }
  if (event.data !== expectedData) {
    throw new AcpProtocolError('ACP terminal event was malformed', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      expectedKind: 'input_echo',
      expectedData,
      actualData: event.data,
    });
  }
  return {
    terminalId: event.terminalId,
    data: event.data,
  };
}

function requireResizeEvent(
  event: TerminalExtensionEvent,
  expectedResize: AcpTerminalResize
): AcpTerminalResizeEvent {
  if (event.kind !== 'resize') {
    throw new AcpProtocolError('ACP terminal event was malformed', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      expectedKind: 'resize',
      actualKind: event.kind,
    });
  }
  if (event.columns !== expectedResize.columns || event.rows !== expectedResize.rows) {
    throw new AcpProtocolError('ACP terminal event was malformed', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      expectedKind: 'resize',
      expectedColumns: expectedResize.columns,
      actualColumns: event.columns,
      expectedRows: expectedResize.rows,
      actualRows: event.rows,
    });
  }
  return {
    terminalId: event.terminalId,
    columns: event.columns,
    rows: event.rows,
  };
}

function requireReconnectSnapshotEvent(
  event: TerminalExtensionEvent,
  expected: { input: string; resize: AcpTerminalResize }
): AcpTerminalReconnectSnapshot {
  if (event.kind !== 'reconnect_snapshot') {
    throw new AcpProtocolError('ACP terminal event was malformed', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      expectedKind: 'reconnect_snapshot',
      actualKind: event.kind,
    });
  }
  if (!event.replayedOutput.includes(expected.input)) {
    throw new AcpProtocolError('ACP terminal event was malformed', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      expectedKind: 'reconnect_snapshot',
      expectedReplayedOutputIncludes: expected.input,
      actualReplayedOutput: event.replayedOutput,
    });
  }
  if (event.columns !== expected.resize.columns || event.rows !== expected.resize.rows) {
    throw new AcpProtocolError('ACP terminal event was malformed', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      expectedKind: 'reconnect_snapshot',
      expectedColumns: expected.resize.columns,
      actualColumns: event.columns,
      expectedRows: expected.resize.rows,
      actualRows: event.rows,
    });
  }
  return {
    terminalId: event.terminalId,
    replayedOutput: event.replayedOutput,
    columns: event.columns,
    rows: event.rows,
  };
}

function requireObjectResponse(
  message: JsonRpcSuccess<unknown>,
  label: string
): JsonRpcSuccess<JsonObject> {
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: requireObject(message.result, label),
  };
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new AcpProtocolError(`${label} must be an object`, { value });
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AcpProtocolError(`${label} must be a string`, {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      value,
    });
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new AcpProtocolError(`${label} must be a number`, {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      value,
    });
  }
  return value;
}

function requireExpectedString(
  value: unknown,
  label: string,
  expected: string | null,
  expectedDetailKey: string,
  actualDetailKey: string,
  message = 'ACP terminal event was malformed'
): string {
  const actual = requireString(value, label);
  if (expected !== null && actual !== expected) {
    throw new AcpProtocolError(message, {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      [expectedDetailKey]: expected,
      [actualDetailKey]: actual,
    });
  }
  return actual;
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

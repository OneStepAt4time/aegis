import type {
  AcpBackendClient,
  AcpJsonObject,
  AcpJsonRpcNotification,
  AcpJsonRpcRequestOptions,
  AcpJsonValue,
  AcpSessionRecord,
  AcpSessionScope,
} from './index.js';

const TERMINAL_EXTENSION_PARITY_AREA = 'terminal-extension';
const DEFAULT_EVENT_TIMEOUT_MS = 15_000;
const MAX_TERMINAL_REPLAY_BYTES = 64 * 1024;

export const ACP_TERMINAL_BRIDGE_UNVERIFIED_CASES: readonly string[] = [
  'real claude-agent-acp terminal extension wire compatibility',
  'durable terminal frame replay after Aegis process restart',
  'public REST, MCP, SDK, and dashboard terminal contracts',
];

export interface AcpTerminalBridgeSessionResolver {
  getSession(sessionId: string, scope: AcpSessionScope): Promise<AcpSessionRecord>;
}

export interface AcpTerminalBridgeRuntime {
  client: AcpBackendClient;
  agentCapabilities?: AcpJsonValue;
}

export interface AcpTerminalBridgeRuntimeResolver {
  getRuntime(sessionId: string): AcpTerminalBridgeRuntime | null | undefined;
}

export interface AcpTerminalBridgeOptions {
  sessionResolver: AcpTerminalBridgeSessionResolver;
  runtimeResolver: AcpTerminalBridgeRuntimeResolver;
  eventTimeoutMs?: number;
}

export interface AcpTerminalBridgeScopedInput extends AcpSessionScope {
  sessionId: string;
}

export interface AcpTerminalBridgeOpenResult {
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
}

export interface AcpTerminalBridgeInputRequest extends AcpTerminalBridgeScopedInput {
  terminalId: string;
  data: string;
  requestOptions?: AcpJsonRpcRequestOptions;
}

export interface AcpTerminalBridgeResizeRequest extends AcpTerminalBridgeScopedInput {
  terminalId: string;
  columns: number;
  rows: number;
  requestOptions?: AcpJsonRpcRequestOptions;
}

export interface AcpTerminalBridgeReconnectRequest extends AcpTerminalBridgeScopedInput {
  terminalId: string;
  requestOptions?: AcpJsonRpcRequestOptions;
}

export type AcpTerminalBridgeCloseRequest = AcpTerminalBridgeReconnectRequest;

export interface AcpTerminalBridgeOutputEvent {
  type: 'terminal.output';
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
  data: string;
  source: 'input_echo';
}

export interface AcpTerminalBridgeResizeEvent {
  type: 'terminal.resize';
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
  columns: number;
  rows: number;
}

export interface AcpTerminalBridgeSnapshotEvent {
  type: 'terminal.snapshot';
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
  replayedOutput: string;
  columns: number;
  rows: number;
}

export interface AcpTerminalBridgeDebugEvent {
  type: 'terminal.debug';
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
  level: string;
  message: string;
}

export type AcpTerminalBridgeEvent =
  | AcpTerminalBridgeOutputEvent
  | AcpTerminalBridgeResizeEvent
  | AcpTerminalBridgeSnapshotEvent
  | AcpTerminalBridgeDebugEvent;

interface TerminalContext {
  sessionId: string;
  acpSessionId: string;
  terminalId: string;
  pendingInputEchoes: PendingInputEcho[];
  replayedOutput: string;
  pendingResizes: AcpTerminalBridgeResize[];
  currentResize?: AcpTerminalBridgeResize;
}

interface PendingInputEcho {
  data: string;
}

interface AcpTerminalBridgeResize {
  columns: number;
  rows: number;
}

interface RuntimeBinding {
  client: AcpBackendClient;
  disposeNotification: () => void;
  disposeError: () => void;
  disposeExit: () => void;
}

interface SnapshotWaiter {
  key: string;
  acpSessionId: string;
  terminalId: string;
  timer: NodeJS.Timeout;
  resolve: (event: AcpTerminalBridgeSnapshotEvent) => void;
  reject: (error: Error) => void;
}

type TerminalExtensionEvent =
  | { kind: 'input_echo'; terminalId: string; data: string }
  | { kind: 'resize'; terminalId: string; columns: number; rows: number }
  | {
      kind: 'reconnect_snapshot';
      terminalId: string;
      replayedOutput: string;
      columns: number;
      rows: number;
    };

export class AcpTerminalBridgeError extends Error {
  readonly details: AcpJsonObject;

  constructor(message: string, details: AcpJsonObject = {}) {
    super(message);
    this.name = 'AcpTerminalBridgeError';
    this.details = details;
  }
}

export class AcpTerminalBridgeUnsupportedError extends AcpTerminalBridgeError {
  constructor(details: AcpJsonObject = {}) {
    super('ACP terminal extension is not supported', {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      ...details,
    });
    this.name = 'AcpTerminalBridgeUnsupportedError';
  }
}

export class AcpTerminalBridgeProtocolError extends AcpTerminalBridgeError {
  constructor(message: string, details: AcpJsonObject = {}) {
    super(message, {
      parityArea: TERMINAL_EXTENSION_PARITY_AREA,
      ...details,
    });
    this.name = 'AcpTerminalBridgeProtocolError';
  }
}

export class AcpTerminalBridgeRuntimeUnavailableError extends AcpTerminalBridgeError {
  constructor(sessionId: string) {
    super(`ACP terminal runtime is not active for session: ${sessionId}`, { sessionId });
    this.name = 'AcpTerminalBridgeRuntimeUnavailableError';
  }
}

export class AcpTerminalBridge {
  private readonly sessionResolver: AcpTerminalBridgeSessionResolver;
  private readonly runtimeResolver: AcpTerminalBridgeRuntimeResolver;
  private readonly eventTimeoutMs: number;
  private readonly eventListeners = new Set<(event: AcpTerminalBridgeEvent) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly runtimeBindings = new Map<string, RuntimeBinding>();
  private readonly terminalContexts = new Map<string, TerminalContext>();
  private readonly terminalContextsByAcpKey = new Map<string, TerminalContext>();
  private readonly snapshotWaiters: SnapshotWaiter[] = [];

  constructor(options: AcpTerminalBridgeOptions) {
    this.sessionResolver = options.sessionResolver;
    this.runtimeResolver = options.runtimeResolver;
    this.eventTimeoutMs = options.eventTimeoutMs ?? DEFAULT_EVENT_TIMEOUT_MS;
  }

  onEvent(listener: (event: AcpTerminalBridgeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  async openTerminal(input: AcpTerminalBridgeScopedInput): Promise<AcpTerminalBridgeOpenResult> {
    const session = await this.resolveSession(input);
    const runtime = this.requireRuntime(session.id);
    requireTerminalExtensionCapabilities(runtime.agentCapabilities);
    const response = await runtime.client.request<AcpJsonObject>('terminal/open', {
      sessionId: session.acpAgentSessionId,
    });
    const terminalId = requireString(response.result.terminalId, 'terminal/open terminalId');
    const context = {
      sessionId: session.id,
      acpSessionId: session.acpAgentSessionId,
      terminalId,
      pendingInputEchoes: [],
      pendingResizes: [],
      replayedOutput: '',
    };
    this.storeTerminalContext(context);
    return {
      sessionId: context.sessionId,
      acpSessionId: context.acpSessionId,
      terminalId: context.terminalId,
    };
  }

  async sendInput(input: AcpTerminalBridgeInputRequest): Promise<void> {
    const context = await this.requireTerminalContext(input);
    const runtime = this.requireRuntime(context.sessionId);
    const pendingEcho = { data: input.data };
    context.pendingInputEchoes.push(pendingEcho);
    try {
      await runtime.client.request(
        'terminal/input',
        {
          sessionId: context.acpSessionId,
          terminalId: context.terminalId,
          data: input.data,
        },
        input.requestOptions
      );
    } catch (error) {
      removeByReference(context.pendingInputEchoes, pendingEcho);
      throw error;
    }
  }

  async resizeTerminal(input: AcpTerminalBridgeResizeRequest): Promise<void> {
    const context = await this.requireTerminalContext(input);
    const runtime = this.requireRuntime(context.sessionId);
    const requestedResize = { columns: input.columns, rows: input.rows };
    context.pendingResizes.push(requestedResize);
    try {
      await runtime.client.request(
        'terminal/resize',
        {
          sessionId: context.acpSessionId,
          terminalId: context.terminalId,
          columns: input.columns,
          rows: input.rows,
        },
        input.requestOptions
      );
    } catch (error) {
      removeByReference(context.pendingResizes, requestedResize);
      throw error;
    }
  }

  async reconnectTerminal(
    input: AcpTerminalBridgeReconnectRequest
  ): Promise<AcpTerminalBridgeSnapshotEvent> {
    const context = await this.requireTerminalContext(input);
    const runtime = this.requireRuntime(context.sessionId);
    const waiter = this.createSnapshotWaiter(context);
    try {
      await runtime.client.request(
        'terminal/resubscribe',
        {
          sessionId: context.acpSessionId,
          terminalId: context.terminalId,
        },
        input.requestOptions
      );
      return await waiter.promise;
    } catch (error) {
      waiter.cancel();
      throw error;
    }
  }

  async closeTerminal(input: AcpTerminalBridgeCloseRequest): Promise<void> {
    const context = await this.requireTerminalContext(input);
    const runtime = this.requireRuntime(context.sessionId);
    await runtime.client.request(
      'terminal/close',
      {
        sessionId: context.acpSessionId,
        terminalId: context.terminalId,
      },
      input.requestOptions
    );
    this.rejectSnapshotWaitersForTerminal(
      context,
      new AcpTerminalBridgeProtocolError('ACP terminal closed before reconnect snapshot', {
        sessionId: context.sessionId,
        acpSessionId: context.acpSessionId,
        terminalId: context.terminalId,
      })
    );
    this.deleteTerminalContext(context);
  }

  disposeSession(sessionId: string): void {
    const runtime = this.runtimeBindings.get(sessionId);
    if (runtime) {
      runtime.disposeNotification();
      runtime.disposeError();
      runtime.disposeExit();
      this.runtimeBindings.delete(sessionId);
    }
    for (const context of [...this.terminalContexts.values()]) {
      if (context.sessionId === sessionId) this.deleteTerminalContext(context);
    }
    this.rejectSnapshotWaitersForSession(
      sessionId,
      new AcpTerminalBridgeRuntimeUnavailableError(sessionId)
    );
  }

  private async resolveSession(input: AcpTerminalBridgeScopedInput): Promise<VerifiedSession> {
    const session = await this.sessionResolver.getSession(input.sessionId, {
      tenantId: input.tenantId,
      ownerKeyId: input.ownerKeyId,
    });
    if (!isNonEmptyString(session.acpAgentSessionId)) {
      throw new AcpTerminalBridgeProtocolError('ACP session is not attached to an agent runtime', {
        sessionId: session.id,
      });
    }
    return {
      ...session,
      acpAgentSessionId: session.acpAgentSessionId,
    };
  }

  private async requireTerminalContext(
    input: AcpTerminalBridgeScopedInput & { terminalId: string }
  ): Promise<TerminalContext> {
    const session = await this.resolveSession(input);
    const context = this.terminalContexts.get(terminalContextKey(session.id, input.terminalId));
    if (!context || context.acpSessionId !== session.acpAgentSessionId) {
      throw new AcpTerminalBridgeProtocolError('ACP terminal is not open for this session', {
        sessionId: session.id,
        terminalId: input.terminalId,
      });
    }
    return context;
  }

  private requireRuntime(sessionId: string): AcpTerminalBridgeRuntime {
    const runtime = this.runtimeResolver.getRuntime(sessionId);
    if (!runtime) throw new AcpTerminalBridgeRuntimeUnavailableError(sessionId);
    this.bindRuntime(sessionId, runtime.client);
    return runtime;
  }

  private bindRuntime(sessionId: string, client: AcpBackendClient): void {
    const existing = this.runtimeBindings.get(sessionId);
    if (existing?.client === client) return;
    if (existing) {
      existing.disposeNotification();
      existing.disposeError();
      existing.disposeExit();
    }
    this.runtimeBindings.set(sessionId, {
      client,
      disposeNotification: client.onNotification(notification =>
        this.handleNotification(sessionId, notification)
      ),
      disposeError: client.onError(error => this.handleRuntimeError(sessionId, error)),
      disposeExit: client.onExit(exit => {
        if (!exit.expected) {
          this.handleRuntimeError(
            sessionId,
            new AcpTerminalBridgeProtocolError('ACP child process exited during terminal stream', {
              sessionId,
              code: exit.code ?? null,
              signal: exit.signal ?? null,
            })
          );
        }
      }),
    });
  }

  private handleNotification(sessionId: string, notification: AcpJsonRpcNotification): void {
    if (notification.method === 'terminal/event') {
      this.handleTerminalEvent(sessionId, notification);
      return;
    }
    if (notification.method === 'terminal/debug') {
      this.handleDebugOutput(sessionId, notification);
    }
  }

  private handleTerminalEvent(sessionId: string, notification: AcpJsonRpcNotification): void {
    let acpSessionId: string;
    let event: TerminalExtensionEvent;
    try {
      const normalized = normalizeTerminalEvent(notification);
      acpSessionId = normalized.acpSessionId;
      event = normalized.event;
    } catch (error) {
      this.failTerminalProtocol(sessionId, error);
      return;
    }

    const context = this.terminalContextsByAcpKey.get(acpTerminalContextKey(acpSessionId, event.terminalId));
    if (!context) {
      this.failTerminalProtocol(
        sessionId,
        new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', {
          acpSessionId,
          ...expectedTerminalDetails(this.snapshotWaiters, acpSessionId, event.terminalId),
        }),
        acpSessionId
      );
      return;
    }

    if (event.kind === 'input_echo') {
      const expectedInput = context.pendingInputEchoes.shift();
      if (expectedInput === undefined) {
        this.failTerminalProtocol(
          context.sessionId,
          new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', {
            expectedKind: 'input_echo',
            actualData: event.data,
          }),
          context.acpSessionId
        );
        return;
      }
      if (event.data !== expectedInput.data) {
        this.failTerminalProtocol(
          context.sessionId,
          new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', {
            expectedKind: 'input_echo',
            expectedData: expectedInput.data,
            actualData: event.data,
          }),
          context.acpSessionId
        );
        return;
      }
      context.replayedOutput = appendLimitedTerminalOutput(context.replayedOutput, event.data);
      this.emitEvent({
        type: 'terminal.output',
        sessionId: context.sessionId,
        acpSessionId: context.acpSessionId,
        terminalId: context.terminalId,
        data: event.data,
        source: 'input_echo',
      });
      return;
    }

    if (event.kind === 'resize') {
      const expectedResize = context.pendingResizes.shift();
      if (expectedResize === undefined) {
        this.failTerminalProtocol(
          context.sessionId,
          new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', {
            expectedKind: 'resize',
            actualColumns: event.columns,
            actualRows: event.rows,
          }),
          context.acpSessionId
        );
        return;
      }
      if (
        (event.columns !== expectedResize.columns || event.rows !== expectedResize.rows)
      ) {
        this.failTerminalProtocol(
          context.sessionId,
          new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', {
            expectedKind: 'resize',
            expectedColumns: expectedResize.columns,
            actualColumns: event.columns,
            expectedRows: expectedResize.rows,
            actualRows: event.rows,
          }),
          context.acpSessionId
        );
        return;
      }
      context.currentResize = { columns: event.columns, rows: event.rows };
      this.emitEvent({
        type: 'terminal.resize',
        sessionId: context.sessionId,
        acpSessionId: context.acpSessionId,
        terminalId: context.terminalId,
        columns: event.columns,
        rows: event.rows,
      });
      return;
    }

    const snapshotError = validateReconnectSnapshot(context, event);
    if (snapshotError) {
      this.failTerminalProtocol(context.sessionId, snapshotError, context.acpSessionId);
      return;
    }
    const snapshot: AcpTerminalBridgeSnapshotEvent = {
      type: 'terminal.snapshot',
      sessionId: context.sessionId,
      acpSessionId: context.acpSessionId,
      terminalId: context.terminalId,
      replayedOutput: event.replayedOutput,
      columns: event.columns,
      rows: event.rows,
    };
    this.emitEvent(snapshot);
    this.resolveSnapshotWaiters(snapshot);
  }

  private handleDebugOutput(sessionId: string, notification: AcpJsonRpcNotification): void {
    try {
      const params = requireObject(notification.params, 'terminal/debug params');
      const acpSessionId = requireString(params.sessionId, 'terminal/debug sessionId');
      const terminalId = requireString(params.terminalId, 'terminal/debug terminalId');
      const level = requireString(params.level, 'terminal/debug level');
      const message = requireString(params.message, 'terminal/debug message');
      const context = this.terminalContextsByAcpKey.get(acpTerminalContextKey(acpSessionId, terminalId));
      if (!context) {
        throw new AcpTerminalBridgeProtocolError('ACP terminal debug output was malformed', {
          acpSessionId,
          terminalId,
        });
      }
      this.emitEvent({
        type: 'terminal.debug',
        sessionId: context.sessionId,
        acpSessionId: context.acpSessionId,
        terminalId: context.terminalId,
        level,
        message,
      });
    } catch (error) {
      this.failTerminalProtocol(sessionId, error);
    }
  }

  private handleRuntimeError(sessionId: string, error: Error): void {
    this.emitError(error);
    this.rejectSnapshotWaitersForSession(sessionId, error);
  }

  private failTerminalProtocol(sessionId: string, error: unknown, acpSessionId?: string): void {
    const normalized =
      error instanceof Error
        ? error
        : new AcpTerminalBridgeProtocolError('ACP terminal event was malformed');
    this.emitError(normalized);
    if (acpSessionId) {
      this.rejectSnapshotWaitersForAcpSession(acpSessionId, normalized);
      return;
    }
    this.rejectSnapshotWaitersForSession(sessionId, normalized);
  }

  private emitEvent(event: AcpTerminalBridgeEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private createSnapshotWaiter(context: TerminalContext): {
    promise: Promise<AcpTerminalBridgeSnapshotEvent>;
    cancel: () => void;
  } {
    const key = terminalContextKey(context.sessionId, context.terminalId);
    let waiter: SnapshotWaiter;
    const promise = new Promise<AcpTerminalBridgeSnapshotEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeSnapshotWaiter(waiter);
        reject(
          new AcpTerminalBridgeProtocolError('ACP terminal event timed out', {
            sessionId: context.sessionId,
            acpSessionId: context.acpSessionId,
            terminalId: context.terminalId,
            expectedKind: 'reconnect_snapshot',
            timeoutMs: this.eventTimeoutMs,
          })
        );
      }, this.eventTimeoutMs);
      waiter = {
        key,
        acpSessionId: context.acpSessionId,
        terminalId: context.terminalId,
        timer,
        resolve,
        reject,
      };
      this.snapshotWaiters.push(waiter);
    });
    return {
      promise,
      cancel: () => {
        this.removeSnapshotWaiter(waiter);
        clearTimeout(waiter.timer);
      },
    };
  }

  private resolveSnapshotWaiters(snapshot: AcpTerminalBridgeSnapshotEvent): void {
    const key = terminalContextKey(snapshot.sessionId, snapshot.terminalId);
    for (const waiter of [...this.snapshotWaiters]) {
      if (waiter.key === key) {
        this.removeSnapshotWaiter(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(snapshot);
      }
    }
  }

  private rejectSnapshotWaitersForSession(sessionId: string, error: Error): void {
    for (const waiter of [...this.snapshotWaiters]) {
      const context = this.terminalContexts.get(waiter.key);
      if (context?.sessionId === sessionId) {
        this.removeSnapshotWaiter(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }

  private rejectSnapshotWaitersForAcpSession(acpSessionId: string, error: Error): void {
    for (const waiter of [...this.snapshotWaiters]) {
      if (waiter.acpSessionId === acpSessionId) {
        this.removeSnapshotWaiter(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }

  private rejectSnapshotWaitersForTerminal(context: TerminalContext, error: Error): void {
    const key = terminalContextKey(context.sessionId, context.terminalId);
    for (const waiter of [...this.snapshotWaiters]) {
      if (waiter.key === key) {
        this.removeSnapshotWaiter(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }

  private removeSnapshotWaiter(waiter: SnapshotWaiter): void {
    const index = this.snapshotWaiters.indexOf(waiter);
    if (index !== -1) this.snapshotWaiters.splice(index, 1);
  }

  private storeTerminalContext(context: TerminalContext): void {
    this.terminalContexts.set(terminalContextKey(context.sessionId, context.terminalId), context);
    this.terminalContextsByAcpKey.set(
      acpTerminalContextKey(context.acpSessionId, context.terminalId),
      context
    );
  }

  private deleteTerminalContext(context: TerminalContext): void {
    this.terminalContexts.delete(terminalContextKey(context.sessionId, context.terminalId));
    this.terminalContextsByAcpKey.delete(acpTerminalContextKey(context.acpSessionId, context.terminalId));
  }
}

interface VerifiedSession extends AcpSessionRecord {
  acpAgentSessionId: string;
}

function normalizeTerminalEvent(notification: AcpJsonRpcNotification): {
  acpSessionId: string;
  event: TerminalExtensionEvent;
} {
  const params = requireObject(notification.params, 'terminal/event params');
  const acpSessionId = requireString(params.sessionId, 'terminal/event sessionId');
  const event = requireObject(params.event, 'terminal/event event');
  const kind = requireString(event.kind, 'terminal/event kind');
  const terminalId = requireString(event.terminalId, 'terminal/event terminalId');

  if (kind === 'input_echo') {
    return {
      acpSessionId,
      event: {
        kind,
        terminalId,
        data: requireStringValue(event.data, 'terminal/event input_echo data'),
      },
    };
  }

  if (kind === 'resize') {
    return {
      acpSessionId,
      event: {
        kind,
        terminalId,
        columns: requireNumber(event.columns, 'terminal/event resize columns'),
        rows: requireNumber(event.rows, 'terminal/event resize rows'),
      },
    };
  }

  if (kind === 'reconnect_snapshot') {
    return {
      acpSessionId,
      event: {
        kind,
        terminalId,
        replayedOutput: requireStringValue(
          event.replayedOutput,
          'terminal/event reconnect_snapshot replayedOutput'
        ),
        columns: requireNumber(event.columns, 'terminal/event reconnect_snapshot columns'),
        rows: requireNumber(event.rows, 'terminal/event reconnect_snapshot rows'),
      },
    };
  }

  throw new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', {
    actualKind: kind,
  });
}

function requireTerminalExtensionCapabilities(agentCapabilities: AcpJsonValue | undefined): void {
  const capabilities = isJsonObject(agentCapabilities) ? agentCapabilities.terminalExtension : undefined;
  if (!isJsonObject(capabilities)) throw new AcpTerminalBridgeUnsupportedError();
  if (
    capabilities.inputEcho !== true ||
    capabilities.resize !== true ||
    capabilities.reconnect !== true ||
    capabilities.debugOutput !== true
  ) {
    throw new AcpTerminalBridgeUnsupportedError();
  }
}

function expectedTerminalDetails(
  waiters: readonly SnapshotWaiter[],
  acpSessionId: string,
  actualTerminalId: string
): AcpJsonObject {
  const waiter = waiters.find(item => item.acpSessionId === acpSessionId);
  if (!waiter) return { actualTerminalId };
  return {
    expectedTerminalId: waiter.terminalId,
    actualTerminalId,
  };
}

function validateReconnectSnapshot(
  context: TerminalContext,
  event: Extract<TerminalExtensionEvent, { kind: 'reconnect_snapshot' }>
): AcpTerminalBridgeProtocolError | null {
  const details: AcpJsonObject = { expectedKind: 'reconnect_snapshot' };
  let invalid = false;

  if (context.replayedOutput && !event.replayedOutput.includes(context.replayedOutput)) {
    details.expectedReplayedOutputIncludes = context.replayedOutput;
    details.actualReplayedOutput = event.replayedOutput;
    invalid = true;
  }

  if (
    context.currentResize &&
    (event.columns !== context.currentResize.columns || event.rows !== context.currentResize.rows)
  ) {
    details.expectedColumns = context.currentResize.columns;
    details.actualColumns = event.columns;
    details.expectedRows = context.currentResize.rows;
    details.actualRows = event.rows;
    invalid = true;
  }

  return invalid ? new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', details) : null;
}

function appendLimitedTerminalOutput(existing: string, chunk: string): string {
  const combined = `${existing}${chunk}`;
  if (combined.length <= MAX_TERMINAL_REPLAY_BYTES) return combined;
  return combined.slice(combined.length - MAX_TERMINAL_REPLAY_BYTES);
}

function removeByReference<T>(values: T[], target: T): void {
  const index = values.indexOf(target);
  if (index !== -1) values.splice(index, 1);
}

function requireObject(value: AcpJsonValue | undefined, label: string): AcpJsonObject {
  if (isJsonObject(value)) return value;
  throw new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', { label });
}

function requireString(value: AcpJsonValue | undefined, label: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  throw new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', { label });
}

function requireStringValue(value: AcpJsonValue | undefined, label: string): string {
  if (typeof value === 'string') return value;
  throw new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', { label });
}

function requireNumber(value: AcpJsonValue | undefined, label: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new AcpTerminalBridgeProtocolError('ACP terminal event was malformed', { label });
}

function isJsonObject(value: AcpJsonValue | undefined): value is AcpJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function terminalContextKey(sessionId: string, terminalId: string): string {
  return `${sessionId}:${terminalId}`;
}

function acpTerminalContextKey(acpSessionId: string, terminalId: string): string {
  return `${acpSessionId}:${terminalId}`;
}

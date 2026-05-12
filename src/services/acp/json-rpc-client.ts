import type {
  AcpChildProcess,
  AcpChildProcessExitEvent,
  AcpChildProcessShutdownOptions,
} from './child-process.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_ID_NAMESPACE = 'aegis-acp';
const DEFAULT_ABANDONED_RESPONSE_GRACE_MS = 60_000;

export type AcpJsonValue =
  | null
  | boolean
  | number
  | string
  | AcpJsonValue[]
  | { [key: string]: AcpJsonValue };
export type AcpJsonObject = { [key: string]: AcpJsonValue };
export type AcpJsonRpcId = string | number | null;
export type AcpJsonRpcClientRequestId = string;

export interface AcpJsonRpcClientOptions {
  child: AcpChildProcess;
  idNamespace?: string;
  requestTimeoutMs?: number;
  abandonedResponseGraceMs?: number;
}

export interface AcpJsonRpcRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AcpJsonRpcSuccess<T = AcpJsonValue> {
  jsonrpc: '2.0';
  id: AcpJsonRpcClientRequestId;
  result: T;
}

export interface AcpJsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: AcpJsonValue;
  raw: AcpJsonObject;
}

export interface AcpJsonRpcInboundRequest {
  jsonrpc: '2.0';
  id: AcpJsonRpcId;
  method: string;
  params?: AcpJsonValue;
  raw: AcpJsonObject;
}

export type AcpJsonRpcErrorDetails = AcpJsonObject;

export interface AcpJsonRpcResponseError {
  code: number;
  message: string;
  data?: AcpJsonValue;
}

export class AcpJsonRpcProtocolError extends Error {
  readonly details: AcpJsonRpcErrorDetails;

  constructor(message: string, details: AcpJsonRpcErrorDetails = {}) {
    super(message);
    this.name = 'AcpJsonRpcProtocolError';
    this.details = details;
  }
}

export class AcpJsonRpcRemoteError extends Error {
  readonly details: AcpJsonRpcErrorDetails;

  constructor(details: AcpJsonRpcErrorDetails) {
    super('ACP JSON-RPC request failed');
    this.name = 'AcpJsonRpcRemoteError';
    this.details = details;
  }
}

export class AcpJsonRpcTimeoutError extends Error {
  readonly details: AcpJsonRpcErrorDetails;

  constructor(details: AcpJsonRpcErrorDetails) {
    super('ACP JSON-RPC request timed out');
    this.name = 'AcpJsonRpcTimeoutError';
    this.details = details;
  }
}

export class AcpJsonRpcRequestCancelledError extends Error {
  readonly details: AcpJsonRpcErrorDetails;

  constructor(details: AcpJsonRpcErrorDetails) {
    super('ACP JSON-RPC request was cancelled');
    this.name = 'AcpJsonRpcRequestCancelledError';
    this.details = details;
  }
}

export class AcpJsonRpcChildExitError extends Error {
  readonly details: AcpJsonRpcErrorDetails;

  constructor(details: AcpJsonRpcErrorDetails) {
    super('ACP child process exited before JSON-RPC response');
    this.name = 'AcpJsonRpcChildExitError';
    this.details = details;
  }
}

export class AcpJsonRpcClosedError extends Error {
  readonly details: AcpJsonRpcErrorDetails;

  constructor(details: AcpJsonRpcErrorDetails = {}) {
    super('ACP JSON-RPC client is closed');
    this.name = 'AcpJsonRpcClosedError';
    this.details = details;
  }
}

interface PendingRequest<T = AcpJsonValue> {
  id: AcpJsonRpcClientRequestId;
  method: string;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abortListener?: () => void;
  resolve: (response: AcpJsonRpcSuccess<T>) => void;
  reject: (error: Error) => void;
}

interface FrameSeparator {
  headerEndIndex: number;
  bodyStartIndex: number;
}

// ACP currently uses newline-delimited JSON in local fixtures; Content-Length
// support is intentionally limited to standard LSP-style frames for ACP agents
// that expose framed JSON-RPC over stdio.
export class AcpJsonRpcClient {
  private readonly child: AcpChildProcess;
  private readonly idNamespace: string;
  private readonly requestTimeoutMs: number;
  private readonly abandonedResponseGraceMs: number;
  private readonly pending = new Map<AcpJsonRpcClientRequestId, PendingRequest<unknown>>();
  private readonly abandonedRequestTimers = new Map<AcpJsonRpcClientRequestId, NodeJS.Timeout>();
  private readonly notificationListeners = new Set<
    (notification: AcpJsonRpcNotification) => void
  >();
  private readonly requestListeners = new Set<(request: AcpJsonRpcInboundRequest) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(exit: AcpChildProcessExitEvent) => void>();
  private stdoutBuffer = '';
  private nextSequence = 1;
  private started = false;
  private closed = false;
  private protocolFailure: AcpJsonRpcProtocolError | null = null;

  constructor(options: AcpJsonRpcClientOptions) {
    this.child = options.child;
    this.idNamespace = normalizeIdNamespace(options.idNamespace ?? DEFAULT_ID_NAMESPACE);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.abandonedResponseGraceMs =
      options.abandonedResponseGraceMs ?? DEFAULT_ABANDONED_RESPONSE_GRACE_MS;

    this.child.on('stdout', event => this.handleStdout(event.chunk));
    this.child.on('exit', event => this.handleChildExit(event));
    this.child.on('error', event => {
      this.fail(
        new AcpJsonRpcProtocolError('ACP child process stream error', {
          message: event.error.message,
        })
      );
    });
  }

  get pendingRequestCount(): number {
    return this.pending.size;
  }

  onNotification(listener: (notification: AcpJsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onRequest(listener: (request: AcpJsonRpcInboundRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onExit(listener: (exit: AcpChildProcessExitEvent) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.closed) throw new AcpJsonRpcClosedError();
    if (this.started) return;
    await this.child.start();
    this.started = true;
  }

  request<T = AcpJsonValue>(
    method: string,
    params?: AcpJsonValue,
    options: AcpJsonRpcRequestOptions = {}
  ): Promise<AcpJsonRpcSuccess<T>> {
    try {
      this.assertWritable(method);
    } catch (error) {
      return Promise.reject(error);
    }

    const id = this.nextRequestId();
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const message = buildOutboundRequest(id, method, params);

    return new Promise<AcpJsonRpcSuccess<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(id, new AcpJsonRpcTimeoutError({ id, method, timeoutMs }), true);
      }, timeoutMs);

      const pending: PendingRequest<unknown> = {
        id,
        method,
        timer,
        signal: options.signal,
        // The transport validates JSON-RPC framing; callers bind T to the method contract.
        resolve: response => resolve(response as AcpJsonRpcSuccess<T>),
        reject,
      };

      if (options.signal) {
        if (options.signal.aborted) {
          clearTimeout(timer);
          reject(new AcpJsonRpcRequestCancelledError({ id, method }));
          return;
        }
        const abortListener = (): void => {
          this.rejectPending(id, new AcpJsonRpcRequestCancelledError({ id, method }), true);
        };
        pending.abortListener = abortListener;
        options.signal.addEventListener('abort', abortListener, { once: true });
      }

      this.pending.set(id, pending);
      this.writeMessage(message).catch(error => {
        this.rejectPending(id, normalizeWriteError(error, id, method));
      });
    });
  }

  async notify(method: string, params?: AcpJsonValue): Promise<void> {
    this.assertWritable(method);
    const message: AcpJsonObject = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    await this.writeMessage(message);
  }

  async shutdown(options: AcpChildProcessShutdownOptions = {}): Promise<AcpChildProcessExitEvent> {
    if (this.closed) return this.child.waitForExit();
    this.closed = true;
    this.rejectAllPending(new AcpJsonRpcClosedError());
    this.clearAbandonedRequestIds();
    return this.child.shutdown(options);
  }

  async respond(id: AcpJsonRpcId, result: AcpJsonValue): Promise<void> {
    if (this.closed || this.protocolFailure) return;
    // AcpJsonRpcId (string | number | null) is a subset of AcpJsonValue
    await this.writeMessage({ jsonrpc: '2.0', id: id as AcpJsonValue, result });
  }

  async respondWithError(id: AcpJsonRpcId, error: AcpJsonRpcResponseError): Promise<void> {
    if (this.closed || this.protocolFailure) return;
    const errorObj: AcpJsonObject = { code: error.code, message: error.message };
    if (error.data !== undefined) errorObj.data = error.data;
    // AcpJsonRpcId (string | number | null) is a subset of AcpJsonValue
    await this.writeMessage({ jsonrpc: '2.0', id: id as AcpJsonValue, error: errorObj });
  }

  private nextRequestId(): AcpJsonRpcClientRequestId {
    const id = `${this.idNamespace}-${this.nextSequence}`;
    this.nextSequence += 1;
    return id;
  }

  private assertWritable(method: string): void {
    if (this.closed) throw new AcpJsonRpcClosedError({ method });
    if (this.protocolFailure) throw this.protocolFailure;
    if (!this.started) {
      throw new AcpJsonRpcProtocolError('ACP JSON-RPC client has not been started', { method });
    }
  }

  private async writeMessage(message: AcpJsonObject): Promise<void> {
    await this.child.writeStdin(`${JSON.stringify(message)}\n`);
  }

  private handleStdout(chunk: string): void {
    if (this.closed || this.protocolFailure) return;
    this.stdoutBuffer += chunk;
    this.drainStdoutBuffer();
  }

  private drainStdoutBuffer(): void {
    while (this.stdoutBuffer.length > 0 && !this.protocolFailure) {
      if (startsWithContentLengthHeader(this.stdoutBuffer)) {
        const frame = this.takeContentLengthFrame();
        if (frame === null) return;
        this.handleFrame(frame);
        continue;
      }

      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) return;
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim() === '') continue;
      this.handleFrame(line);
    }
  }

  private takeContentLengthFrame(): string | null {
    const separator = findHeaderSeparator(this.stdoutBuffer);
    if (!separator) return null;

    const headerText = this.stdoutBuffer.slice(0, separator.headerEndIndex);
    const contentLength = parseContentLength(headerText);
    if (contentLength === null) {
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC framed stdout omitted Content-Length', {
          header: headerText,
        })
      );
      return null;
    }

    const headerAndSeparator = this.stdoutBuffer.slice(0, separator.bodyStartIndex);
    const headerBytes = Buffer.byteLength(headerAndSeparator, 'utf8');
    const bytes = Buffer.from(this.stdoutBuffer, 'utf8');
    const frameEnd = headerBytes + contentLength;
    if (bytes.length < frameEnd) return null;

    const body = bytes.subarray(headerBytes, frameEnd).toString('utf8');
    this.stdoutBuffer = bytes.subarray(frameEnd).toString('utf8');
    return body;
  }

  private handleFrame(frame: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch (error) {
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC stdout contained malformed JSON', {
          frame,
          message: error instanceof Error ? error.message : String(error),
        })
      );
      return;
    }

    if (!isJsonObject(parsed)) {
      this.fail(new AcpJsonRpcProtocolError('ACP JSON-RPC message was not an object', { frame }));
      return;
    }

    this.handleMessage(parsed);
  }

  private handleMessage(message: AcpJsonObject): void {
    if (message.jsonrpc !== '2.0') {
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC message used an unsupported version', { message })
      );
      return;
    }

    const hasId = Object.hasOwn(message, 'id');
    const hasMethod = Object.hasOwn(message, 'method');
    const hasResult = Object.hasOwn(message, 'result');
    const hasError = Object.hasOwn(message, 'error');

    if (hasResult || hasError) {
      this.handleResponseMessage(message, hasResult, hasError);
      return;
    }

    if (!hasMethod || typeof message.method !== 'string') {
      this.fail(
        new AcpJsonRpcProtocolError(
          'ACP JSON-RPC message did not include a method or response payload',
          {
            message,
          }
        )
      );
      return;
    }

    if (hasId) {
      this.handleInboundRequest(message);
      return;
    }

    this.emitNotification({
      jsonrpc: '2.0',
      method: message.method,
      ...(Object.hasOwn(message, 'params') ? { params: message.params } : {}),
      raw: message,
    });
  }

  private handleResponseMessage(
    message: AcpJsonObject,
    hasResult: boolean,
    hasError: boolean
  ): void {
    if (hasResult === hasError) {
      this.fail(
        new AcpJsonRpcProtocolError(
          'ACP JSON-RPC response must include exactly one of result or error',
          {
            message,
          }
        )
      );
      return;
    }

    if (typeof message.id !== 'string') {
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC response id was not a client request id', {
          message,
        })
      );
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      if (this.clearAbandonedRequestId(message.id)) return;
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC response id did not match a pending request', {
          id: message.id,
          message,
        })
      );
      return;
    }

    this.clearPending(pending);
    this.pending.delete(message.id);

    if (hasError) {
      const remoteError = normalizeRemoteError(message.error);
      if (!remoteError) {
        pending.reject(
          new AcpJsonRpcProtocolError('ACP JSON-RPC error response was malformed', {
            id: message.id,
            method: pending.method,
            error: message.error ?? null,
          })
        );
        return;
      }
      pending.reject(
        new AcpJsonRpcRemoteError({
          id: message.id,
          method: pending.method,
          error: remoteError,
        })
      );
      return;
    }

    pending.resolve({
      jsonrpc: '2.0',
      id: message.id,
      // The caller chooses T for the JSON-RPC method contract; this transport only validates framing.
      result: message.result as unknown,
    });
  }

  private handleInboundRequest(message: AcpJsonObject): void {
    if (!isJsonRpcId(message.id)) {
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC inbound request id was invalid', { message })
      );
      return;
    }
    if (typeof message.method !== 'string') {
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC inbound request method was invalid', { message })
      );
      return;
    }
    this.emitRequest({
      jsonrpc: '2.0',
      id: message.id,
      method: message.method,
      ...(Object.hasOwn(message, 'params') ? { params: message.params } : {}),
      raw: message,
    });
  }

  private rejectPending(id: AcpJsonRpcClientRequestId, error: Error, abandoned = false): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.clearPending(pending);
    this.pending.delete(id);
    if (abandoned) this.trackAbandonedRequestId(id);
    pending.reject(error);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      this.clearPending(pending);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private clearPending(pending: PendingRequest<unknown>): void {
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
  }

  private fail(error: AcpJsonRpcProtocolError): void {
    if (this.protocolFailure) return;
    this.protocolFailure = error;
    this.rejectAllPending(error);
    this.clearAbandonedRequestIds();
    this.emitError(error);
  }

  private handleChildExit(exit: AcpChildProcessExitEvent): void {
    this.clearAbandonedRequestIds();
    if (this.stdoutBuffer.trim() !== '' && !this.protocolFailure) {
      this.fail(
        new AcpJsonRpcProtocolError('ACP JSON-RPC stdout ended with an unterminated frame', {
          frame: this.stdoutBuffer,
        })
      );
    }

    for (const pending of this.pending.values()) {
      this.clearPending(pending);
      pending.reject(
        new AcpJsonRpcChildExitError({
          id: pending.id,
          method: pending.method,
          code: exit.code,
          signal: exit.signal,
          expected: exit.expected,
        })
      );
    }
    this.pending.clear();
    for (const listener of this.exitListeners) listener(exit);
  }

  private emitNotification(notification: AcpJsonRpcNotification): void {
    for (const listener of this.notificationListeners) listener(notification);
  }

  private emitRequest(request: AcpJsonRpcInboundRequest): void {
    for (const listener of this.requestListeners) listener(request);
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }

  private trackAbandonedRequestId(id: AcpJsonRpcClientRequestId): void {
    this.clearAbandonedRequestId(id);
    const timer = setTimeout(() => {
      this.abandonedRequestTimers.delete(id);
    }, this.abandonedResponseGraceMs);
    timer.unref();
    this.abandonedRequestTimers.set(id, timer);
  }

  private clearAbandonedRequestId(id: AcpJsonRpcClientRequestId): boolean {
    const timer = this.abandonedRequestTimers.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    this.abandonedRequestTimers.delete(id);
    return true;
  }

  private clearAbandonedRequestIds(): void {
    for (const timer of this.abandonedRequestTimers.values()) {
      clearTimeout(timer);
    }
    this.abandonedRequestTimers.clear();
  }
}

function buildOutboundRequest(
  id: AcpJsonRpcClientRequestId,
  method: string,
  params: AcpJsonValue | undefined
): AcpJsonObject {
  const message: AcpJsonObject = { jsonrpc: '2.0', id, method };
  if (params !== undefined) message.params = params;
  return message;
}

function normalizeIdNamespace(namespace: string): string {
  const trimmed = namespace.trim();
  if (trimmed === '' || /[\r\n\0]/.test(trimmed)) {
    throw new AcpJsonRpcProtocolError(
      'ACP JSON-RPC id namespace must be a non-empty single-line string'
    );
  }
  return trimmed;
}

function normalizeWriteError(
  error: unknown,
  id: AcpJsonRpcClientRequestId,
  method: string
): AcpJsonRpcProtocolError {
  if (error instanceof AcpJsonRpcProtocolError) return error;
  return new AcpJsonRpcProtocolError('ACP JSON-RPC request write failed', {
    id,
    method,
    message: error instanceof Error ? error.message : String(error),
  });
}

function startsWithContentLengthHeader(buffer: string): boolean {
  return /^Content-Length:/i.test(buffer);
}

function findHeaderSeparator(buffer: string): FrameSeparator | null {
  const crlfIndex = buffer.indexOf('\r\n\r\n');
  if (crlfIndex !== -1) {
    return { headerEndIndex: crlfIndex, bodyStartIndex: crlfIndex + 4 };
  }

  const lfIndex = buffer.indexOf('\n\n');
  if (lfIndex !== -1) {
    return { headerEndIndex: lfIndex, bodyStartIndex: lfIndex + 2 };
  }

  return null;
}

function parseContentLength(headerText: string): number | null {
  for (const line of headerText.split(/\r?\n/)) {
    const match = /^Content-Length:\s*(\d+)$/i.exec(line.trim());
    if (!match) continue;
    const length = Number(match[1]);
    return Number.isSafeInteger(length) ? length : null;
  }
  return null;
}

function isJsonRpcId(value: AcpJsonValue | undefined): value is AcpJsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

function isJsonObject(value: unknown): value is AcpJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value);
}

function isJsonValue(value: unknown): value is AcpJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isJsonValue);
}

function normalizeRemoteError(error: AcpJsonValue | undefined): AcpJsonObject | null {
  if (!isJsonObject(error)) return null;
  if (typeof error.code !== 'number' || typeof error.message !== 'string') return null;
  return error;
}

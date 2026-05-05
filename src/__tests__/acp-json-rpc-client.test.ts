import { EventEmitter } from 'node:events';
import nodeProcess from 'node:process';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { AcpChildProcess, type AcpChildProcessHandle } from '../services/acp/child-process.js';
import {
  AcpJsonRpcChildExitError,
  AcpJsonRpcClient,
  AcpJsonRpcProtocolError,
  AcpJsonRpcRemoteError,
  AcpJsonRpcRequestCancelledError,
  AcpJsonRpcTimeoutError,
} from '../services/acp/json-rpc-client.js';

describe('AcpJsonRpcClient', () => {
  it('generates namespaced ids and serializes JSON-RPC requests to ACP stdin', async () => {
    const { client, process } = createClient({ idNamespace: 'acp-test' });
    await client.start();

    const response = client.request<{ ok: boolean }>('initialize', { clientCapabilities: {} });
    await waitForWrites(process.stdin, 1);

    expect(process.stdin.writes).toEqual([
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'acp-test-1',
        method: 'initialize',
        params: { clientCapabilities: {} },
      })}\n`,
    ]);

    process.writeStdout({ jsonrpc: '2.0', id: 'acp-test-1', result: { ok: true } });

    await expect(response).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'acp-test-1',
      result: { ok: true },
    });
  });

  it('parses newline and Content-Length framed responses and preserves raw notifications', async () => {
    const { client, process } = createClient({ idNamespace: 'frame-test' });
    const notifications: unknown[] = [];
    client.onNotification(notification => notifications.push(notification));
    await client.start();

    const first = client.request<{ sequence: number }>('first');
    const second = client.request<{ sequence: number }>('second', { value: true });
    await waitForWrites(process.stdin, 2);

    process.stdout.write(
      contentLengthFrame({ jsonrpc: '2.0', id: 'frame-test-2', result: { sequence: 2 } })
    );
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'fixture-session', update: { sessionUpdate: 'raw_update' } },
      })}\n`
    );
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 'frame-test-1', result: { sequence: 1 } })}\n`
    );

    await expect(first).resolves.toMatchObject({ id: 'frame-test-1', result: { sequence: 1 } });
    await expect(second).resolves.toMatchObject({ id: 'frame-test-2', result: { sequence: 2 } });
    expect(notifications).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'fixture-session', update: { sessionUpdate: 'raw_update' } },
        raw: {
          jsonrpc: '2.0',
          method: 'session/update',
          params: { sessionId: 'fixture-session', update: { sessionUpdate: 'raw_update' } },
        },
      },
    ]);
  });

  it('emits inbound ACP JSON-RPC requests without mapping them to Aegis domain events', async () => {
    const { client, process } = createClient();
    const requests: unknown[] = [];
    client.onRequest(request => requests.push(request));
    await client.start();

    process.writeStdout({
      jsonrpc: '2.0',
      id: 'permission-1',
      method: 'session/request_permission',
      params: { sessionId: 'fixture-session', options: [] },
    });

    expect(requests).toEqual([
      {
        jsonrpc: '2.0',
        id: 'permission-1',
        method: 'session/request_permission',
        params: { sessionId: 'fixture-session', options: [] },
        raw: {
          jsonrpc: '2.0',
          id: 'permission-1',
          method: 'session/request_permission',
          params: { sessionId: 'fixture-session', options: [] },
        },
      },
    ]);
  });

  it('rejects malformed JSON and protocol violations explicitly', async () => {
    const { client, process } = createClient({ idNamespace: 'bad-json' });
    const errors: Error[] = [];
    client.onError(error => errors.push(error));
    await client.start();

    const pending = client.request('initialize');
    await waitForWrites(process.stdin, 1);
    process.stdout.write('not-json\n');

    await expect(pending).rejects.toBeInstanceOf(AcpJsonRpcProtocolError);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'ACP JSON-RPC stdout contained malformed JSON',
      details: expect.objectContaining({ frame: 'not-json' }),
    });

    const { client: protocolClient, process: protocolProcess } = createClient();
    const protocolErrors: Error[] = [];
    protocolClient.onError(error => protocolErrors.push(error));
    await protocolClient.start();
    protocolProcess.writeStdout({ jsonrpc: '2.0', id: 'missing-request', result: {} });

    expect(protocolErrors[0]).toBeInstanceOf(AcpJsonRpcProtocolError);
    expect(protocolErrors[0]).toMatchObject({
      message: 'ACP JSON-RPC response id did not match a pending request',
    });
  });

  it('rejects JSON-RPC error responses on the matching pending request only', async () => {
    const { client, process } = createClient({ idNamespace: 'remote-error' });
    await client.start();

    const rejected = client.request('failing');
    const fulfilled = client.request('succeeds');
    await waitForWrites(process.stdin, 2);

    process.writeStdout({
      jsonrpc: '2.0',
      id: 'remote-error-1',
      error: { code: -32602, message: 'invalid params', data: { field: 'cwd' } },
    });
    process.writeStdout({ jsonrpc: '2.0', id: 'remote-error-2', result: { ok: true } });

    await expect(rejected).rejects.toMatchObject({
      name: 'AcpJsonRpcRemoteError',
      message: 'ACP JSON-RPC request failed',
      details: {
        id: 'remote-error-1',
        method: 'failing',
        error: { code: -32602, message: 'invalid params', data: { field: 'cwd' } },
      },
    });
    await expect(fulfilled).resolves.toMatchObject({ id: 'remote-error-2', result: { ok: true } });
  });

  it('handles request timeouts and AbortSignal cancellation without leaking pending requests', async () => {
    const { client, process } = createClient({
      idNamespace: 'cancel-test',
      requestTimeoutMs: 20,
    });
    await client.start();

    await expect(client.request('hang')).rejects.toBeInstanceOf(AcpJsonRpcTimeoutError);

    const controller = new AbortController();
    const cancelled = client.request('cancel-me', undefined, { signal: controller.signal });
    await waitForWrites(process.stdin, 2);
    controller.abort();

    await expect(cancelled).rejects.toBeInstanceOf(AcpJsonRpcRequestCancelledError);
    process.writeStdout({ jsonrpc: '2.0', id: 'cancel-test-2', result: { ignored: true } });
    expect(client.pendingRequestCount).toBe(0);
    const afterCancel = client.request('after-cancel');
    await waitForWrites(process.stdin, 3);
    process.writeStdout({ jsonrpc: '2.0', id: 'cancel-test-3', result: { ok: true } });
    await expect(afterCancel).resolves.toMatchObject({
      id: 'cancel-test-3',
      result: { ok: true },
    });
  });

  it('expires abandoned timeout and cancellation ids after the late-response grace window', async () => {
    const { client, process } = createClient({
      idNamespace: 'abandoned-test',
      requestTimeoutMs: 10,
      abandonedResponseGraceMs: 10,
    });
    const errors: Error[] = [];
    client.onError(error => errors.push(error));
    await client.start();

    await expect(client.request('timeout-without-response')).rejects.toBeInstanceOf(
      AcpJsonRpcTimeoutError
    );
    const controller = new AbortController();
    const cancelled = client.request('cancel-without-response', undefined, {
      signal: controller.signal,
    });
    await waitForWrites(process.stdin, 2);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(AcpJsonRpcRequestCancelledError);

    await waitForCondition(() => errors.length === 0);
    await delay(25);
    process.writeStdout({ jsonrpc: '2.0', id: 'abandoned-test-1', result: { tooLate: true } });

    expect(errors[0]).toMatchObject({
      message: 'ACP JSON-RPC response id did not match a pending request',
      details: expect.objectContaining({ id: 'abandoned-test-1' }),
    });
  });

  it('rejects pending requests when the ACP child exits before responding', async () => {
    const { client, process } = createClient({ idNamespace: 'exit-test' });
    await client.start();

    const pending = client.request('initialize');
    await waitForWrites(process.stdin, 1);
    process.emitExit(42, null);

    await expect(pending).rejects.toBeInstanceOf(AcpJsonRpcChildExitError);
    await expect(pending).rejects.toMatchObject({
      message: 'ACP child process exited before JSON-RPC response',
      details: expect.objectContaining({ code: 42, id: 'exit-test-1', method: 'initialize' }),
    });
  });

  it('performs clean shutdown and prevents further writes after closing', async () => {
    const { client, process } = createClient();
    await client.start();

    await expect(client.shutdown({ graceMs: 50 })).resolves.toMatchObject({
      code: 0,
      signal: null,
      expected: true,
      escalated: false,
    });

    expect(process.stdin.writableEnded).toBe(true);
    await expect(client.request('after-close')).rejects.toMatchObject({
      message: 'ACP JSON-RPC client is closed',
    });
  });
});

interface TestClientOptions {
  idNamespace?: string;
  requestTimeoutMs?: number;
  abandonedResponseGraceMs?: number;
}

function createClient(options: TestClientOptions = {}): {
  client: AcpJsonRpcClient;
  process: FakeChildProcess;
} {
  const process = new FakeChildProcess();
  const child = new AcpChildProcess({
    command: 'fake-acp',
    cwd: nodeProcess.cwd(),
    spawnProcess: () => process,
  });
  return {
    client: new AcpJsonRpcClient({
      child,
      idNamespace: options.idNamespace ?? 'aegis-acp-test',
      requestTimeoutMs: options.requestTimeoutMs ?? 1_000,
      abandonedResponseGraceMs: options.abandonedResponseGraceMs,
    }),
    process,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (predicate()) return;
    await delay(1);
  }
  throw new Error('condition was not met');
}

function contentLengthFrame(message: Record<string, unknown>): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

async function waitForWrites(stdin: CapturingWritable, count: number): Promise<void> {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (stdin.writes.length >= count) return;
    await new Promise<void>(resolve => {
      setTimeout(resolve, 1);
    });
  }
  throw new Error(`Expected ${count} stdin writes, got ${stdin.writes.length}`);
}

class CapturingWritable extends Writable {
  readonly writes: string[] = [];

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }
}

class FakeChildProcess extends EventEmitter implements AcpChildProcessHandle {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new CapturingWritable();
  readonly pid = 9876;
  readonly killedSignals: (NodeJS.Signals | number | undefined)[] = [];

  constructor() {
    super();
    this.stdin.on('finish', () => this.emitExit(0, null));
    queueMicrotask(() => this.emit('spawn'));
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killedSignals.push(signal);
    this.emitExit(null, typeof signal === 'string' ? signal : null);
    return true;
  }

  writeStdout(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    queueMicrotask(() => {
      this.emit('exit', code, signal);
      this.emit('close', code, signal);
    });
  }
}

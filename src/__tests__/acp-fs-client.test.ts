import { EventEmitter } from 'node:events';
import nodeProcess from 'node:process';
import { PassThrough, Writable } from 'node:stream';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcpChildProcess, type AcpChildProcessHandle } from '../services/acp/child-process.js';
import { AcpFsClient } from '../services/acp/fs-client.js';
import {
  ACP_FS_ERROR_INVALID_PARAMS,
  ACP_FS_ERROR_IO,
  ACP_FS_ERROR_METHOD_NOT_FOUND,
  ACP_FS_ERROR_PATH_TRAVERSAL,
} from '../services/acp/fs-client-handler.js';
import { AcpJsonRpcClient } from '../services/acp/json-rpc-client.js';

vi.mock('node:fs/promises');

const WORKDIR = `/home/user/project`;

describe('AcpFsClient', () => {
  let rpcClient: AcpJsonRpcClient;
  let fakeProcess: FakeChildProcess;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ rpcClient, fakeProcess } = createRpcClient());
    await rpcClient.start();
  });

  // --- constructor ---

  it('throws when workdir is empty', () => {
    expect(() => new AcpFsClient(rpcClient, { workdir: '' })).toThrow(
      'AcpFsClient requires a non-empty workdir'
    );
  });

  // --- fs/read_text_file ---

  it('reads a file within the workdir and responds with its content', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('hello' as never);

    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'fs/read_text_file',
      params: { path: 'notes.txt' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { content: 'hello' },
    });
  });

  it('reads a file specified as an absolute path inside the workdir', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('abc' as never);

    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-abs',
      method: 'fs/read_text_file',
      params: { path: resolve(WORKDIR, 'file.ts') },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({ id: 'req-abs', result: { content: 'abc' } });
  });

  it('returns INVALID_PARAMS when read path is missing', async () => {
    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-2',
      method: 'fs/read_text_file',
      params: {},
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-2',
      error: { code: ACP_FS_ERROR_INVALID_PARAMS },
    });
  });

  it('returns PATH_TRAVERSAL error when read path escapes the workdir via ..', async () => {
    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-3',
      method: 'fs/read_text_file',
      params: { path: '../../etc/passwd' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-3',
      error: { code: ACP_FS_ERROR_PATH_TRAVERSAL },
    });
  });

  it('returns PATH_TRAVERSAL error when read path is an absolute path outside the workdir', async () => {
    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-abs-escape',
      method: 'fs/read_text_file',
      params: { path: '/etc/passwd' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-abs-escape',
      error: { code: ACP_FS_ERROR_PATH_TRAVERSAL },
    });
  });

  it('returns IO error when readFile throws', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));

    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-nofile',
      method: 'fs/read_text_file',
      params: { path: 'missing.txt' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-nofile',
      error: { code: ACP_FS_ERROR_IO, message: expect.stringContaining('ENOENT') },
    });
  });

  // --- fs/write_text_file ---

  it('writes a file within the workdir and responds with an empty result', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-w1',
      method: 'fs/write_text_file',
      params: { path: 'output.txt', content: 'written content' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toEqual({
      jsonrpc: '2.0',
      id: 'req-w1',
      result: {},
    });
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      resolve(WORKDIR, 'output.txt'),
      'written content',
      'utf8'
    );
  });

  it('returns INVALID_PARAMS when write params are missing content', async () => {
    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-w2',
      method: 'fs/write_text_file',
      params: { path: 'out.txt' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-w2',
      error: { code: ACP_FS_ERROR_INVALID_PARAMS },
    });
  });

  it('returns PATH_TRAVERSAL error when write path escapes the workdir', async () => {
    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-w3',
      method: 'fs/write_text_file',
      params: { path: '../sibling/evil.txt', content: 'x' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-w3',
      error: { code: ACP_FS_ERROR_PATH_TRAVERSAL },
    });
  });

  it('returns IO error when writeFile throws', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockRejectedValue(new Error('EACCES: permission denied'));

    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-w4',
      method: 'fs/write_text_file',
      params: { path: 'locked.txt', content: 'data' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-w4',
      error: { code: ACP_FS_ERROR_IO, message: expect.stringContaining('EACCES') },
    });
  });

  // --- unknown fs/ method ---

  it('returns METHOD_NOT_FOUND for unknown fs/ methods', async () => {
    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'req-unknown',
      method: 'fs/list_directory',
      params: { path: '.' },
    });

    const written = await waitForWrite(fakeProcess.stdin);
    expect(JSON.parse(written)).toMatchObject({
      id: 'req-unknown',
      error: { code: ACP_FS_ERROR_METHOD_NOT_FOUND, message: 'Method not found: fs/list_directory' },
    });
  });

  // --- non-fs methods are ignored ---

  it('does not respond to non-fs inbound requests', async () => {
    new AcpFsClient(rpcClient, { workdir: WORKDIR });
    fakeProcess.writeStdout({
      jsonrpc: '2.0',
      id: 'perm-1',
      method: 'session/request_permission',
      params: { sessionId: 'abc', options: [] },
    });

    // Give any microtasks a chance to run
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    expect(fakeProcess.stdin.writes).toHaveLength(0);
  });
});

// --- test helpers ---

function createRpcClient(): { rpcClient: AcpJsonRpcClient; fakeProcess: FakeChildProcess } {
  const fakeProcess = new FakeChildProcess();
  const child = new AcpChildProcess({
    command: 'fake-acp',
    cwd: nodeProcess.cwd(),
    spawnProcess: () => fakeProcess,
  });
  return {
    rpcClient: new AcpJsonRpcClient({
      child,
      idNamespace: 'aegis-fs-test',
      requestTimeoutMs: 1_000,
    }),
    fakeProcess,
  };
}

async function waitForWrite(stdin: CapturingWritable, timeoutMs = 500): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stdin.writes.length > 0) return stdin.writes[stdin.writes.length - 1];
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`No stdin write within ${timeoutMs}ms`);
}

class CapturingWritable extends Writable {
  readonly writes: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
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

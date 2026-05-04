import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { AcpBinaryResolutionError } from '../services/acp/binary-resolver.js';
import {
  AcpChildProcess,
  type AcpChildProcessHandle,
} from '../services/acp/child-process.js';

const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'fake-acp-child-process.mjs');

describe('AcpChildProcess supervision', () => {
  it('spawns the resolved command with explicit args, cwd, and BYO provider environment passthrough', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath, '--fixture-arg'],
      cwd: process.cwd(),
      env: {
        FAKE_ACP_CHILD_MODE: 'print-env',
        ACP_CHILD_TEST_VALUE: 'custom-value',
      },
      providerEnv: {
        ANTHROPIC_AUTH_TOKEN: 'synthetic-token',
      },
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.on('stdout', event => stdout.push(event.chunk));
    child.on('stderr', event => stderr.push(event.chunk));

    const started = await child.start();
    const exit = await child.waitForExit();

    expect(started.pid).toEqual(expect.any(Number));
    expect(started.command).toMatchObject({
      command: process.execPath,
      args: [fixturePath, '--fixture-arg'],
      source: 'explicit',
    });
    expect(exit).toMatchObject({ code: 0, signal: null, expected: false, escalated: false });
    const payload = JSON.parse(stdout.join('').trim()) as {
      argv: string[];
      cwd: string;
      customEnv?: string;
      providerEnv: boolean;
      noColor?: string;
    };
    expect(payload.argv).toEqual(['--fixture-arg']);
    expect(payload.cwd).toBe(process.cwd());
    expect(payload.customEnv).toBe('custom-value');
    expect(payload.providerEnv).toBe(true);
    expect(payload.noColor).toBe('1');
    expect(stderr.join('')).toContain('fixture stderr ready');
  });

  it('propagates structured binary resolver failures without spawning', async () => {
    const resolverError = new AcpBinaryResolutionError('missing test binary', {
      attemptedPaths: ['D:\\missing\\claude-agent-acp.mjs'],
      binName: 'claude-agent-acp',
      envVar: 'AEGIS_ACP_BIN',
      packageName: '@agentclientprotocol/claude-agent-acp',
      reason: 'package bin not found',
    });
    const child = new AcpChildProcess({
      cwd: process.cwd(),
      resolveCommand: () => {
        throw resolverError;
      },
    });

    await expect(child.start()).rejects.toBe(resolverError);
    expect(child.status).toBe('failed');
  });

  it('surfaces missing explicit command startup failures and emits an error event', async () => {
    const child = new AcpChildProcess({
      command: 'definitely-missing-acp-command-for-aegis-tests',
      cwd: process.cwd(),
      env: { AEGIS_ACP_BIN: undefined },
    });
    const errors: Error[] = [];
    child.on('error', event => errors.push(event.error));

    await expect(child.start()).rejects.toMatchObject({
      name: 'AcpChildProcessStartError',
      code: 'AEGIS_ACP_CHILD_PROCESS_START_FAILED',
      details: expect.objectContaining({ command: 'definitely-missing-acp-command-for-aegis-tests' }),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('failed to start');
  });

  it('forwards stdout and stderr as raw chunks without JSON-RPC parsing', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath],
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'stream' },
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.on('stdout', event => stdout.push(event.chunk));
    child.on('stderr', event => stderr.push(event.chunk));

    await child.start();
    await child.waitForExit();

    expect(stdout.join('')).toContain('stdout-one\n');
    expect(stdout.join('')).toContain('stdout-two\n');
    expect(stderr.join('')).toContain('stderr-one\n');
    expect(stderr.join('')).toContain('stderr-two\n');
  });

  it('marks graceful shutdown exits as expected when stdin close lets the child exit', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath],
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'wait-for-stdin-close' },
    });
    const exits: unknown[] = [];
    child.on('exit', event => exits.push(event));

    await child.start();
    const exit = await child.shutdown({ graceMs: 1_000 });

    expect(exit).toMatchObject({ code: 0, signal: null, expected: true, escalated: false });
    expect(exits).toEqual([exit]);
  });

  it('escalates shutdown when the supervised child ignores graceful termination', async () => {
    const fake = new FakeChildProcess();
    const child = new AcpChildProcess({
      command: 'fake-acp',
      cwd: process.cwd(),
      spawnProcess: () => fake,
    });

    await child.start();
    const exit = await child.shutdown({ graceMs: 5 });

    expect(fake.killedSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(exit).toMatchObject({ code: null, signal: 'SIGKILL', expected: true, escalated: true });
  });

  it('emits an unexpected exit event for non-zero child termination', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath],
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'exit-nonzero' },
    });
    const exits: unknown[] = [];
    child.on('exit', event => exits.push(event));

    await child.start();
    const exit = await child.waitForExit();

    expect(exit).toMatchObject({ code: 7, signal: null, expected: false, escalated: false });
    expect(exits).toEqual([exit]);
  });
});

class FakeChildProcess extends EventEmitter implements AcpChildProcessHandle {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({ write(_chunk, _encoding, callback): void { callback(); } });
  readonly killedSignals: NodeJS.Signals[] = [];
  readonly pid = 12345;

  constructor() {
    super();
    queueMicrotask(() => this.emit('spawn'));
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    if (typeof signal === 'string') {
      this.killedSignals.push(signal);
      if (signal === 'SIGKILL') {
        queueMicrotask(() => {
          this.emit('exit', null, 'SIGKILL');
          this.emit('close', null, 'SIGKILL');
        });
      }
    }
    return true;
  }
}

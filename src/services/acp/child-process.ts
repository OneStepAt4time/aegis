import { spawn } from 'node:child_process';

import { buildAcpResolveEnv, buildAcpSpawnEnv } from '../../acp-spawn-env.js';
import {
  resolveClaudeAgentAcpBinary,
  type ResolveAcpCommandOptions,
  type ResolvedAcpCommand,
} from './binary-resolver.js';

const DEFAULT_SHUTDOWN_GRACE_MS = 2_000;

export type AcpChildProcessStatus = 'idle' | 'starting' | 'running' | 'exited' | 'failed';

export interface AcpChildProcessStartResult {
  pid?: number;
  command: ResolvedAcpCommand;
}

export interface AcpChildProcessOutputEvent {
  chunk: string;
}

export type AcpChildProcessSpawnedEvent = AcpChildProcessStartResult;

export interface AcpChildProcessExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
  escalated: boolean;
}

export interface AcpChildProcessErrorEvent {
  error: Error;
}

export interface AcpChildProcessShutdownOptions {
  graceMs?: number;
}

export interface AcpChildProcessSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: 'pipe';
  windowsHide: true;
  detached?: boolean;
}

export interface AcpReadableProcessStream {
  setEncoding(encoding: BufferEncoding): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
}

export interface AcpWritableProcessStream {
  readonly destroyed: boolean;
  readonly writable: boolean;
  readonly writableEnded: boolean;
  write(chunk: string, callback?: (error: Error | null | undefined) => void): boolean;
  end(): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface AcpChildProcessHandle {
  readonly pid?: number;
  readonly stdout: AcpReadableProcessStream;
  readonly stderr: AcpReadableProcessStream;
  readonly stdin: AcpWritableProcessStream;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'spawn', listener: () => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'exit' | 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
}

export type AcpChildProcessSpawner = (
  command: string,
  args: readonly string[],
  options: AcpChildProcessSpawnOptions
) => AcpChildProcessHandle;

export interface AcpChildProcessOptions {
  resolvedCommand?: ResolvedAcpCommand;
  command?: string;
  args?: readonly string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  providerEnv?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  resolveCommand?: (options: ResolveAcpCommandOptions) => ResolvedAcpCommand;
  spawnProcess?: AcpChildProcessSpawner;
}

export interface AcpChildProcessErrorDetails {
  command: string;
  args: string[];
  cwd: string;
  message: string;
}

export class AcpChildProcessStartError extends Error {
  readonly code = 'AEGIS_ACP_CHILD_PROCESS_START_FAILED';
  readonly details: AcpChildProcessErrorDetails;

  constructor(details: AcpChildProcessErrorDetails) {
    super(`ACP child process failed to start: ${details.message}`);
    this.name = 'AcpChildProcessStartError';
    this.details = details;
  }
}

export class AcpChildProcessStateError extends Error {
  readonly code = 'AEGIS_ACP_CHILD_PROCESS_INVALID_STATE';

  constructor(message: string) {
    super(message);
    this.name = 'AcpChildProcessStateError';
  }
}

// Process-boundary supervision only; JSON-RPC framing and backend lifecycle restart policy are downstream ACP modules.
export class AcpChildProcess {
  private statusValue: AcpChildProcessStatus = 'idle';
  private resolvedCommand?: ResolvedAcpCommand;
  private child?: AcpChildProcessHandle;
  private exitPromise?: Promise<AcpChildProcessExitEvent>;
  private exitResult?: AcpChildProcessExitEvent;
  private shutdownRequested = false;
  private shutdownEscalated = false;
  private exitObserved: { code: number | null; signal: NodeJS.Signals | null } | undefined;

  private readonly stdoutListeners = new Set<(event: AcpChildProcessOutputEvent) => void>();
  private readonly stderrListeners = new Set<(event: AcpChildProcessOutputEvent) => void>();
  private readonly spawnedListeners = new Set<(event: AcpChildProcessSpawnedEvent) => void>();
  private readonly exitListeners = new Set<(event: AcpChildProcessExitEvent) => void>();
  private readonly errorListeners = new Set<(event: AcpChildProcessErrorEvent) => void>();

  constructor(private readonly options: AcpChildProcessOptions) {}

  get status(): AcpChildProcessStatus {
    return this.statusValue;
  }

  get command(): ResolvedAcpCommand | undefined {
    return this.resolvedCommand;
  }

  on(event: 'stdout', listener: (event: AcpChildProcessOutputEvent) => void): this;
  on(event: 'stderr', listener: (event: AcpChildProcessOutputEvent) => void): this;
  on(event: 'spawned', listener: (event: AcpChildProcessSpawnedEvent) => void): this;
  on(event: 'exit', listener: (event: AcpChildProcessExitEvent) => void): this;
  on(event: 'error', listener: (event: AcpChildProcessErrorEvent) => void): this;
  on(
    event: 'stdout' | 'stderr' | 'spawned' | 'exit' | 'error',
    listener:
      | ((event: AcpChildProcessOutputEvent) => void)
      | ((event: AcpChildProcessSpawnedEvent) => void)
      | ((event: AcpChildProcessExitEvent) => void)
      | ((event: AcpChildProcessErrorEvent) => void)
  ): this {
    // The overload signatures bind each event name to its listener payload type.
    // TypeScript does not carry that relationship into the shared implementation.
    switch (event) {
      case 'stdout':
        this.stdoutListeners.add(listener as (event: AcpChildProcessOutputEvent) => void);
        break;
      case 'stderr':
        this.stderrListeners.add(listener as (event: AcpChildProcessOutputEvent) => void);
        break;
      case 'spawned':
        this.spawnedListeners.add(listener as (event: AcpChildProcessSpawnedEvent) => void);
        break;
      case 'exit':
        this.exitListeners.add(listener as (event: AcpChildProcessExitEvent) => void);
        break;
      case 'error':
        this.errorListeners.add(listener as (event: AcpChildProcessErrorEvent) => void);
        break;
    }
    return this;
  }

  off(event: 'stdout', listener: (event: AcpChildProcessOutputEvent) => void): this;
  off(event: 'stderr', listener: (event: AcpChildProcessOutputEvent) => void): this;
  off(event: 'spawned', listener: (event: AcpChildProcessSpawnedEvent) => void): this;
  off(event: 'exit', listener: (event: AcpChildProcessExitEvent) => void): this;
  off(event: 'error', listener: (event: AcpChildProcessErrorEvent) => void): this;
  off(
    event: 'stdout' | 'stderr' | 'spawned' | 'exit' | 'error',
    listener:
      | ((event: AcpChildProcessOutputEvent) => void)
      | ((event: AcpChildProcessSpawnedEvent) => void)
      | ((event: AcpChildProcessExitEvent) => void)
      | ((event: AcpChildProcessErrorEvent) => void)
  ): this {
    // The overload signatures bind each event name to its listener payload type.
    // TypeScript does not carry that relationship into the shared implementation.
    switch (event) {
      case 'stdout':
        this.stdoutListeners.delete(listener as (event: AcpChildProcessOutputEvent) => void);
        break;
      case 'stderr':
        this.stderrListeners.delete(listener as (event: AcpChildProcessOutputEvent) => void);
        break;
      case 'spawned':
        this.spawnedListeners.delete(listener as (event: AcpChildProcessSpawnedEvent) => void);
        break;
      case 'exit':
        this.exitListeners.delete(listener as (event: AcpChildProcessExitEvent) => void);
        break;
      case 'error':
        this.errorListeners.delete(listener as (event: AcpChildProcessErrorEvent) => void);
        break;
    }
    return this;
  }

  async start(): Promise<AcpChildProcessStartResult> {
    if (this.statusValue !== 'idle') {
      throw new AcpChildProcessStateError(
        `Cannot start ACP child process from ${this.statusValue}`
      );
    }

    this.statusValue = 'starting';
    let resolvedCommand: ResolvedAcpCommand;
    try {
      resolvedCommand = this.resolveCommand();
    } catch (error) {
      this.statusValue = 'failed';
      throw error;
    }
    this.resolvedCommand = resolvedCommand;

    const spawnOptions: AcpChildProcessSpawnOptions = {
      cwd: this.options.cwd,
      env: buildAcpSpawnEnv(
        this.options.env,
        definedEnv(this.options.providerEnv),
        process.env,
        this.options.platform ?? process.platform
      ),
      stdio: 'pipe',
      windowsHide: true,
      detached: true,  // Issue #3250: new process group for clean tree-kill
    };

    let child: AcpChildProcessHandle;
    try {
      child = this.spawnProcess(resolvedCommand, spawnOptions);
    } catch (error) {
      const startError = this.toStartError(error, resolvedCommand);
      this.statusValue = 'failed';
      this.emitError(startError);
      throw startError;
    }

    this.child = child;
    this.attachStreams(child);
    this.exitPromise = this.createExitPromise(child);

    return new Promise<AcpChildProcessStartResult>((resolve, reject) => {
      let settled = false;
      child.once('spawn', () => {
        settled = true;
        this.statusValue = 'running';
        const result: AcpChildProcessStartResult = {
          pid: child.pid,
          command: resolvedCommand,
        };
        this.emitSpawned(result);
        resolve(result);
      });
      child.once('error', error => {
        const startError = this.toStartError(error, resolvedCommand);
        if (!settled) {
          settled = true;
          this.statusValue = 'failed';
          this.emitError(startError);
          reject(startError);
          return;
        }
        this.emitError(startError);
      });
    });
  }

  async waitForExit(): Promise<AcpChildProcessExitEvent> {
    if (this.exitResult) return this.exitResult;
    if (!this.exitPromise) {
      throw new AcpChildProcessStateError('Cannot wait for an ACP child process before start');
    }
    return this.exitPromise;
  }

  async writeStdin(chunk: string): Promise<void> {
    const child = this.child;
    if (!child || !this.exitPromise) {
      throw new AcpChildProcessStateError('Cannot write to an ACP child process before start');
    }
    if (this.exitResult) {
      throw new AcpChildProcessStateError('Cannot write to an exited ACP child process');
    }
    if (child.stdin.destroyed || child.stdin.writableEnded || !child.stdin.writable) {
      throw new AcpChildProcessStateError('Cannot write to closed ACP child process stdin');
    }

    await new Promise<void>((resolve, reject) => {
      try {
        child.stdin.write(chunk, error => {
          if (error) {
            reject(errorToError(error));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(errorToError(error));
      }
    });
  }

  async shutdown(options: AcpChildProcessShutdownOptions = {}): Promise<AcpChildProcessExitEvent> {
    if (this.exitResult) return this.exitResult;
    if (!this.child || !this.exitPromise) {
      throw new AcpChildProcessStateError('Cannot shut down an ACP child process before start');
    }

    this.shutdownRequested = true;
    const graceMs = options.graceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    this.endStdin();
    const gracefulExit = await this.waitForExitWithin(graceMs);
    if (gracefulExit) return gracefulExit;

    // Issue #3250: Kill entire process group (catches hook child processes)
    try { process.kill(-this.child.pid!, 'SIGTERM'); } catch { this.child.kill('SIGTERM'); }
    const terminatedExit = await this.waitForExitWithin(graceMs);
    if (terminatedExit) return terminatedExit;

    this.shutdownEscalated = true;
    try { process.kill(-this.child.pid!, 'SIGKILL'); } catch { this.child.kill('SIGKILL'); }
    return this.waitForExit();
  }

  private resolveCommand(): ResolvedAcpCommand {
    if (this.options.resolvedCommand) {
      return {
        ...this.options.resolvedCommand,
        args: [...this.options.resolvedCommand.args],
      };
    }

    if (this.options.command && this.options.command.trim() !== '') {
      return {
        command: this.options.command,
        args: [...(this.options.args ?? [])],
        source: 'explicit',
      };
    }

    const resolver = this.options.resolveCommand ?? resolveClaudeAgentAcpBinary;
    return resolver({
      cwd: this.options.cwd,
      env: buildAcpResolveEnv(this.options.env),
      platform: this.options.platform,
    });
  }

  private spawnProcess(
    resolvedCommand: ResolvedAcpCommand,
    options: AcpChildProcessSpawnOptions
  ): AcpChildProcessHandle {
    const spawner = this.options.spawnProcess ?? defaultSpawner;
    return spawner(resolvedCommand.command, resolvedCommand.args, options);
  }

  private attachStreams(child: AcpChildProcessHandle): void {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.emitStdout({ chunk }));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => this.emitStderr({ chunk }));
    child.stdin.on('error', error => this.emitError(error));
  }

  private createExitPromise(child: AcpChildProcessHandle): Promise<AcpChildProcessExitEvent> {
    return new Promise(resolve => {
      child.once('exit', (code, signal) => {
        this.exitObserved = { code, signal };
      });
      child.once('close', (code, signal) => {
        const finalCode = code ?? this.exitObserved?.code ?? null;
        const finalSignal = signal ?? this.exitObserved?.signal ?? null;
        const result: AcpChildProcessExitEvent = {
          code: finalCode,
          signal: finalSignal,
          expected: this.shutdownRequested,
          escalated: this.shutdownEscalated,
        };
        this.exitResult = result;
        this.statusValue = this.statusValue === 'failed' ? 'failed' : 'exited';
        this.emitExit(result);
        resolve(result);
      });
    });
  }

  private async waitForExitWithin(timeoutMs: number): Promise<AcpChildProcessExitEvent | null> {
    if (this.exitResult) return this.exitResult;
    if (!this.exitPromise) return null;
    return Promise.race([
      this.exitPromise,
      new Promise<null>(resolve => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  }

  private endStdin(): void {
    if (!this.child || this.child.stdin.destroyed) return;
    try {
      this.child.stdin.end();
    } catch (error) {
      this.emitError(errorToError(error));
    }
  }

  private toStartError(error: unknown, command: ResolvedAcpCommand): AcpChildProcessStartError {
    const normalizedError = errorToError(error);
    return new AcpChildProcessStartError({
      command: command.command,
      args: [...command.args],
      cwd: this.options.cwd,
      message: normalizedError.message,
    });
  }

  private emitStdout(event: AcpChildProcessOutputEvent): void {
    for (const listener of this.stdoutListeners) listener(event);
  }

  private emitStderr(event: AcpChildProcessOutputEvent): void {
    for (const listener of this.stderrListeners) listener(event);
  }

  private emitSpawned(event: AcpChildProcessSpawnedEvent): void {
    for (const listener of this.spawnedListeners) listener(event);
  }

  private emitExit(event: AcpChildProcessExitEvent): void {
    for (const listener of this.exitListeners) listener(event);
  }

  private emitError(error: Error): void {
    const event: AcpChildProcessErrorEvent = { error };
    for (const listener of this.errorListeners) listener(event);
  }
}

const defaultSpawner: AcpChildProcessSpawner = (command, args, options) =>
  spawn(command, [...args], options);

function errorToError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function definedEnv(env: Record<string, string | undefined> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!env) return result;
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

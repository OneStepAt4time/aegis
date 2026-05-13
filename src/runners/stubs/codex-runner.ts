/**
 * runners/stubs/codex-runner.ts — Stub Codex runner (interface only).
 *
 * Issue #3263: Placeholder for OpenAI Codex CLI integration.
 * Will be implemented when Codex CLI gains ACP/stdio support.
 */

import type {
  AgentRunner,
  ProcessHandle,
  RunnerStartConfig,
  RunnerStartResult,
  RunnerSendResult,
  OutputChunk,
  RunnerKillOptions,
  RunnerKillResult,
} from '../types.js';
import { NotImplementedError } from './shared.js';

/**
 * CodexRunner — stub implementation for OpenAI Codex CLI.
 *
 * All methods throw to indicate this runner is not yet implemented.
 * Registered in the runner registry to prove interface compatibility
 * and allow configuration references.
 */
export class CodexRunner implements AgentRunner {
  readonly name = 'codex';

  async start(_sessionId: string, _config: RunnerStartConfig): Promise<RunnerStartResult> {
    throw new NotImplementedError('CodexRunner.start');
  }

  async sendInput(_handle: ProcessHandle, _input: string): Promise<RunnerSendResult> {
    throw new NotImplementedError('CodexRunner.sendInput');
  }

  // Note: the throw occurs before any yield, so the caller gets a rejected
  // promise rather than an error during iteration.
  async *readOutput(_handle: ProcessHandle): AsyncIterable<OutputChunk> {
    throw new NotImplementedError('CodexRunner.readOutput');
  }

  async kill(_handle: ProcessHandle, _options?: RunnerKillOptions): Promise<RunnerKillResult> {
    throw new NotImplementedError('CodexRunner.kill');
  }

  isAlive(_handle: ProcessHandle): boolean {
    return false;
  }

  getHandle(_sessionId: string): ProcessHandle | undefined {
    return undefined;
  }
}

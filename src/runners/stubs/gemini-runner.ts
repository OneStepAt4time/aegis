/**
 * runners/stubs/gemini-runner.ts — Stub Gemini CLI runner (interface only).
 *
 * Issue #3263: Placeholder for Google Gemini CLI integration.
 * Will be implemented when Gemini CLI gains ACP/stdio support.
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
 * GeminiCliRunner — stub implementation for Google Gemini CLI.
 *
 * All methods throw to indicate this runner is not yet implemented.
 * Registered in the runner registry to prove interface compatibility
 * and allow configuration references.
 */
export class GeminiCliRunner implements AgentRunner {
  readonly name = 'gemini-cli';

  async start(_sessionId: string, _config: RunnerStartConfig): Promise<RunnerStartResult> {
    throw new NotImplementedError('GeminiCliRunner.start');
  }

  async sendInput(_handle: ProcessHandle, _input: string): Promise<RunnerSendResult> {
    throw new NotImplementedError('GeminiCliRunner.sendInput');
  }

  // Note: the throw occurs before any yield, so the caller gets a rejected
  // promise rather than an error during iteration.
  async *readOutput(_handle: ProcessHandle): AsyncIterable<OutputChunk> {
    throw new NotImplementedError('GeminiCliRunner.readOutput');
  }

  async kill(_handle: ProcessHandle, _options?: RunnerKillOptions): Promise<RunnerKillResult> {
    throw new NotImplementedError('GeminiCliRunner.kill');
  }

  isAlive(_handle: ProcessHandle): boolean {
    return false;
  }

  getHandle(_sessionId: string): ProcessHandle | undefined {
    return undefined;
  }
}

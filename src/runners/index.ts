/**
 * runners/index.ts — Barrel export for the runner abstraction.
 *
 * Issue #3263: Pluggable agent backend interface.
 */

export type {
  AgentRunner,
  RunnerRegistry,
  ProcessHandle,
  OutputChunk,
  RunnerStartConfig,
  RunnerStartResult,
  RunnerSendResult,
  RunnerKillOptions,
  RunnerKillResult,
} from './types.js';

export { InMemoryRunnerRegistry } from './registry.js';

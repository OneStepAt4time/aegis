/**
 * runners/registry.ts — In-memory RunnerRegistry implementation.
 *
 * Issue #3263: Manages registered agent runners and resolves them by name.
 */

import type { AgentRunner, RunnerRegistry } from './types.js';

export class InMemoryRunnerRegistry implements RunnerRegistry {
  private readonly runners = new Map<string, AgentRunner>();
  private defaultRunner: AgentRunner | undefined;

  register(runner: AgentRunner): void {
    this.runners.set(runner.name, runner);
    // First registered runner becomes the default
    if (!this.defaultRunner) {
      this.defaultRunner = runner;
    }
  }

  get(name: string): AgentRunner | undefined {
    return this.runners.get(name);
  }

  listNames(): string[] {
    return [...this.runners.keys()];
  }

  getDefault(): AgentRunner {
    if (!this.defaultRunner) {
      throw new Error('No runners registered. Register at least one AgentRunner.');
    }
    return this.defaultRunner;
  }
}

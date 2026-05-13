/**
 * fix-3263-runner-abstraction.test.ts — Tests for the Runner abstraction layer.
 *
 * Issue #3263: AgentRunner interface, RunnerRegistry, and stub runners.
 */

import { describe, expect, it } from 'vitest';

import type {
  AgentRunner,
  ProcessHandle,
  RunnerStartConfig,
  RunnerStartResult,
  RunnerSendResult,
  OutputChunk,
  RunnerKillResult,
} from '../runners/types.js';
import { InMemoryRunnerRegistry } from '../runners/registry.js';
import { CodexRunner } from '../runners/stubs/codex-runner.js';
import { GeminiCliRunner } from '../runners/stubs/gemini-runner.js';

// ── Test helpers ─────────────────────────────────────────────────

/** A minimal mock runner for testing the registry. */
class MockRunner implements AgentRunner {
  readonly name: string;
  private readonly handles = new Map<string, ProcessHandle>();
  private alive = new Set<ProcessHandle>();

  constructor(name: string) {
    this.name = name;
  }

  async start(sessionId: string, _config: RunnerStartConfig): Promise<RunnerStartResult> {
    const handle = `${this.name}-${sessionId}`;
    this.handles.set(sessionId, handle);
    this.alive.add(handle);
    return { handle, capabilities: { mock: true }, agentInfo: { name: this.name } };
  }

  async sendInput(handle: ProcessHandle, _input: string): Promise<RunnerSendResult> {
    if (!this.alive.has(handle)) return { delivered: false, attempts: 1, error: 'not alive' };
    return { delivered: true, attempts: 1 };
  }

  async *readOutput(_handle: ProcessHandle): AsyncIterable<OutputChunk> {
    yield { text: 'mock output', source: 'stdout', timestamp: new Date().toISOString() };
  }

  async kill(handle: ProcessHandle): Promise<RunnerKillResult> {
    this.alive.delete(handle);
    return { exitCode: 0, clean: true };
  }

  isAlive(handle: ProcessHandle): boolean {
    return this.alive.has(handle);
  }

  getHandle(sessionId: string): ProcessHandle | undefined {
    return this.handles.get(sessionId);
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('Issue #3263 — Runner abstraction layer', () => {
  describe('AgentRunner interface', () => {
    it('MockRunner satisfies the interface contract', async () => {
      const runner = new MockRunner('test-runner');
      expect(runner.name).toBe('test-runner');

      const result = await runner.start('session-1', { cwd: '/tmp' });
      expect(result.handle).toBe('test-runner-session-1');
      expect(result.capabilities).toEqual({ mock: true });

      expect(runner.isAlive(result.handle)).toBe(true);
      expect(runner.getHandle('session-1')).toBe(result.handle);

      const sendResult = await runner.sendInput(result.handle, 'hello');
      expect(sendResult.delivered).toBe(true);

      const killResult = await runner.kill(result.handle);
      expect(killResult.clean).toBe(true);
      expect(runner.isAlive(result.handle)).toBe(false);
    });

    it('runner swap does not break session lifecycle', async () => {
      const runnerA = new MockRunner('runner-a');
      const runnerB = new MockRunner('runner-b');

      const resultA = await runnerA.start('swap-session', { cwd: '/tmp' });
      expect(runnerA.isAlive(resultA.handle)).toBe(true);

      await runnerA.kill(resultA.handle);
      expect(runnerA.isAlive(resultA.handle)).toBe(false);

      const resultB = await runnerB.start('swap-session', { cwd: '/tmp' });
      expect(runnerB.isAlive(resultB.handle)).toBe(true);
      expect(resultB.handle).not.toBe(resultA.handle);
    });
  });

  describe('RunnerRegistry', () => {
    it('registers and retrieves runners', () => {
      const registry = new InMemoryRunnerRegistry();
      const runner = new MockRunner('claude-code');
      registry.register(runner);

      expect(registry.get('claude-code')).toBe(runner);
      expect(registry.listNames()).toEqual(['claude-code']);
    });

    it('first registered runner becomes default', () => {
      const registry = new InMemoryRunnerRegistry();
      const first = new MockRunner('first');
      const second = new MockRunner('second');

      registry.register(first);
      registry.register(second);

      expect(registry.getDefault()).toBe(first);
      expect(registry.listNames()).toEqual(['first', 'second']);
    });

    it('throws when no runners registered and getDefault is called', () => {
      const registry = new InMemoryRunnerRegistry();
      expect(() => registry.getDefault()).toThrow('No runners registered');
    });

    it('returns undefined for unknown runner name', () => {
      const registry = new InMemoryRunnerRegistry();
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('supports multiple runners', () => {
      const registry = new InMemoryRunnerRegistry();
      registry.register(new MockRunner('claude-code'));
      registry.register(new MockRunner('codex'));
      registry.register(new MockRunner('gemini-cli'));

      expect(registry.listNames()).toHaveLength(3);
      expect(registry.listNames()).toContain('claude-code');
      expect(registry.listNames()).toContain('codex');
      expect(registry.listNames()).toContain('gemini-cli');
    });
  });

  describe('CodexRunner stub', () => {
    it('implements AgentRunner interface', () => {
      const runner = new CodexRunner();
      expect(runner.name).toBe('codex');
      expect(runner.isAlive('any')).toBe(false);
      expect(runner.getHandle('any')).toBeUndefined();
    });

    it('throws on start', async () => {
      const runner = new CodexRunner();
      await expect(runner.start('s1', { cwd: '/tmp' })).rejects.toThrow('not implemented');
    });

    it('throws on sendInput', async () => {
      const runner = new CodexRunner();
      await expect(runner.sendInput('h1', 'test')).rejects.toThrow('not implemented');
    });

    it('throws on kill', async () => {
      const runner = new CodexRunner();
      await expect(runner.kill('h1')).rejects.toThrow('not implemented');
    });
  });

  describe('GeminiCliRunner stub', () => {
    it('implements AgentRunner interface', () => {
      const runner = new GeminiCliRunner();
      expect(runner.name).toBe('gemini-cli');
      expect(runner.isAlive('any')).toBe(false);
      expect(runner.getHandle('any')).toBeUndefined();
    });

    it('throws on start', async () => {
      const runner = new GeminiCliRunner();
      await expect(runner.start('s1', { cwd: '/tmp' })).rejects.toThrow('not implemented');
    });
  });

  describe('Integration: registry with stubs', () => {
    it('all stub runners compile and register', () => {
      const registry = new InMemoryRunnerRegistry();
      registry.register(new CodexRunner());
      registry.register(new GeminiCliRunner());

      expect(registry.listNames()).toEqual(['codex', 'gemini-cli']);
      expect(registry.get('codex')).toBeInstanceOf(CodexRunner);
      expect(registry.get('gemini-cli')).toBeInstanceOf(GeminiCliRunner);
    });
  });
});

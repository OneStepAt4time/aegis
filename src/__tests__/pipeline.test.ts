/**
 * pipeline.test.ts — Comprehensive tests for PipelineManager.
 *
 * Covers DAG validation, cycle detection, stage advancement,
 * polling, cleanup timers, batchCreate edge cases, and accessors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineManager } from '../pipeline.js';
import type { BatchSessionSpec, PipelineConfig } from '../pipeline.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { SessionEventBus } from '../events.js';
import { JsonFileStore } from '../services/state/JsonFileStore.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Helpers: mock factories
// ---------------------------------------------------------------------------

function makeMockSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    windowId: `@${id.slice(0, 4)}`,
    windowName: `cc-${id.slice(0, 8)}`,
    workDir: '/app',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 0,
    permissionStallMs: 0,
    permissionMode: 'default',
    ...overrides,
  };
}

function makeMockSessions(): {
  mock: SessionManager;
  createSession: ReturnType<typeof vi.fn>;
  sendInitialPrompt: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
} {
  const createSession = vi.fn();
  const sendInitialPrompt = vi.fn();
  const getSession = vi.fn();
  const mock = { createSession, sendInitialPrompt, getSession } as unknown as SessionManager;
  return { mock, createSession, sendInitialPrompt, getSession };
}

function makeMockEventBus(): {
  mock: SessionEventBus;
  emitEnded: ReturnType<typeof vi.fn>;
} {
  const emitEnded = vi.fn();
  const mock = { emitEnded } as unknown as SessionEventBus;
  return { mock, emitEnded };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PipelineManager', () => {
  let sessions: ReturnType<typeof makeMockSessions>;
  let eventBus: ReturnType<typeof makeMockEventBus>;
  let manager: PipelineManager;

  beforeEach(() => {
    sessions = makeMockSessions();
    eventBus = makeMockEventBus();
    manager = new PipelineManager(sessions.mock, eventBus.mock);
    // #1805: Default mock — prompt delivery succeeds
    sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. DAG Validation
  // =========================================================================

  describe('DAG validation', () => {
    it('accepts valid dependsOn references', async () => {
      const config: PipelineConfig = {
        name: 'valid',
        workDir: '/app',
        stages: [
          { name: 'build', prompt: 'build it', dependsOn: [] },
          { name: 'test', prompt: 'test it', dependsOn: ['build'] },
          { name: 'deploy', prompt: 'deploy it', dependsOn: ['test'] },
        ],
      };
      sessions.createSession.mockResolvedValue(makeMockSession('sess-1'));

      const pipeline = await manager.createPipeline(config);
      expect(pipeline.status).toBe('running');
    });

    it('throws on invalid dependsOn reference', async () => {
      const config: PipelineConfig = {
        name: 'bad-dep',
        workDir: '/app',
        stages: [
          { name: 'build', prompt: 'build', dependsOn: ['nonexistent'] },
        ],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow(
        'Stage "build" depends on unknown stage "nonexistent"',
      );
    });

    it('accepts empty stages list (no stages, no deps)', async () => {
      const config: PipelineConfig = {
        name: 'empty',
        workDir: '/app',
        stages: [],
      };

      const pipeline = await manager.createPipeline(config);
      // All zero stages are completed trivially
      expect(pipeline.status).toBe('completed');
    });

    it('starts stages with no dependsOn immediately', async () => {
      const config: PipelineConfig = {
        name: 'immediate',
        workDir: '/app',
        stages: [
          { name: 'alpha', prompt: 'do alpha', dependsOn: [] },
          { name: 'beta', prompt: 'do beta', dependsOn: [] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('sess-alpha'))
        .mockResolvedValueOnce(makeMockSession('sess-beta'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      expect(sessions.createSession).toHaveBeenCalledTimes(2);
      expect(pipeline.stages.find(s => s.name === 'alpha')?.status).toBe('running');
      expect(pipeline.stages.find(s => s.name === 'beta')?.status).toBe('running');
    });

    it('uses pipeline-level workDir when stage has none', async () => {
      const config: PipelineConfig = {
        name: 'workdir',
        workDir: '/global/dir',
        stages: [
          { name: 'stage-no-dir', prompt: 'run', dependsOn: [] },
          { name: 'stage-with-dir', prompt: 'run', dependsOn: [], workDir: '/custom/dir' },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s1'))
        .mockResolvedValueOnce(makeMockSession('s2'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config);

      // First stage: no workDir, should use pipeline workDir
      expect(sessions.createSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
        workDir: '/global/dir',
      }));
      // Second stage: has own workDir
      expect(sessions.createSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
        workDir: '/custom/dir',
      }));
    });
  });

  // =========================================================================
  // 2. Cycle Detection (DFS algorithm)
  // =========================================================================

  describe('cycle detection', () => {
    it('detects self-referencing stage: A dependsOn ["A"]', async () => {
      const config: PipelineConfig = {
        name: 'self-ref',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: ['A'] },
        ],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow(
        'Circular dependency detected involving stage "A"',
      );
    });

    it('accepts linear chain: A -> B -> C', async () => {
      const config: PipelineConfig = {
        name: 'linear',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
          { name: 'C', prompt: 'c', dependsOn: ['B'] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));

      const pipeline = await manager.createPipeline(config);
      // A starts immediately; B and C stay pending
      expect(pipeline.status).toBe('running');
      expect(pipeline.stages.find(s => s.name === 'A')?.status).toBe('running');
      expect(pipeline.stages.find(s => s.name === 'B')?.status).toBe('pending');
      expect(pipeline.stages.find(s => s.name === 'C')?.status).toBe('pending');
    });

    it('accepts diamond: A -> B, A -> C -> D', async () => {
      const config: PipelineConfig = {
        name: 'diamond',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
          { name: 'C', prompt: 'c', dependsOn: ['A'] },
          { name: 'D', prompt: 'd', dependsOn: ['C'] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));

      const pipeline = await manager.createPipeline(config);
      expect(pipeline.status).toBe('running');
    });

    it('detects direct cycle: A -> B -> A', async () => {
      const config: PipelineConfig = {
        name: 'direct-cycle',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: ['B'] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
        ],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow(
        /Circular dependency detected involving stage "[AB]"/,
      );
    });

    it('detects indirect cycle: A -> B -> C -> A', async () => {
      const config: PipelineConfig = {
        name: 'indirect-cycle',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: ['C'] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
          { name: 'C', prompt: 'c', dependsOn: ['B'] },
        ],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow(
        /Circular dependency detected/,
      );
    });

    it('detects cycle in complex multi-component graph', async () => {
      // Components: X -> Y -> Z (valid), but P -> Q -> P (cycle)
      const config: PipelineConfig = {
        name: 'multi-cycle',
        workDir: '/app',
        stages: [
          { name: 'X', prompt: 'x', dependsOn: [] },
          { name: 'Y', prompt: 'y', dependsOn: ['X'] },
          { name: 'Z', prompt: 'z', dependsOn: ['Y'] },
          { name: 'P', prompt: 'p', dependsOn: ['Q'] },
          { name: 'Q', prompt: 'q', dependsOn: ['P'] },
        ],
      };

      await expect(manager.createPipeline(config)).rejects.toThrow(
        /Circular dependency detected/,
      );
    });
  });

  // =========================================================================
  // 3. Stage Advancement
  // =========================================================================

  describe('stage advancement', () => {
    it('advances stages whose dependencies are all completed', async () => {
      const config: PipelineConfig = {
        name: 'advance',
        workDir: '/app',
        stages: [
          { name: 'first', prompt: 'run first', dependsOn: [] },
          { name: 'second', prompt: 'run second', dependsOn: ['first'] },
        ],
      };

      // First stage: starts immediately
      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-first'))
        .mockResolvedValueOnce(makeMockSession('s-second'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);
      expect(pipeline.stages[0].status).toBe('running');
      expect(pipeline.stages[1].status).toBe('pending');

      // Simulate first stage completing (session goes idle)
      sessions.getSession.mockReturnValue(makeMockSession('s-first', { status: 'idle' }));
      // Need a fresh mock for the second stage creation
      sessions.createSession.mockResolvedValue(makeMockSession('s-second'));

      // Trigger polling to detect completion and advance
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('completed');
      expect(pipeline.stages[1].status).toBe('running');
    });

    it('keeps stage waiting until all dependencies complete', async () => {
      const config: PipelineConfig = {
        name: 'wait-deps',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: [] },
          { name: 'C', prompt: 'c', dependsOn: ['A', 'B'] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-a'))
        .mockResolvedValueOnce(makeMockSession('s-b'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // A completes, B still running
      sessions.getSession.mockImplementation((id: string) => {
        if (id === 's-a') return makeMockSession('s-a', { status: 'idle' });
        if (id === 's-b') return makeMockSession('s-b', { status: 'working' });
        return null;
      });

      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // A completed, B still running, C still pending (waiting for B)
      expect(pipeline.stages.find(s => s.name === 'A')?.status).toBe('completed');
      expect(pipeline.stages.find(s => s.name === 'B')?.status).toBe('running');
      expect(pipeline.stages.find(s => s.name === 'C')?.status).toBe('pending');
    });

    it('fails pipeline when any dependency fails', async () => {
      const config: PipelineConfig = {
        name: 'dep-fail',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-a'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Simulate A failing: session disappears
      sessions.getSession.mockReturnValue(null);

      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages.find(s => s.name === 'A')?.status).toBe('failed');
      expect(pipeline.status).toBe('failed');
    });

    it('advancePipeline is no-op when pipeline is completed', async () => {
      const config: PipelineConfig = {
        name: 'already-done',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Simulate the only stage completing
      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('completed');

      // Reset call count, then poll again — no new sessions should be created
      const createCalls = sessions.createSession.mock.calls.length;
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();
      expect(sessions.createSession.mock.calls.length).toBe(createCalls);
    });

    it('advancePipeline is no-op when pipeline is failed', async () => {
      const config: PipelineConfig = {
        name: 'already-failed',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Force fail the pipeline
      sessions.getSession.mockReturnValue(null);
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('failed');

      const createCalls = sessions.createSession.mock.calls.length;
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();
      expect(sessions.createSession.mock.calls.length).toBe(createCalls);
    });

    it('starts stages with no dependencies immediately on createPipeline', async () => {
      const config: PipelineConfig = {
        name: 'no-deps',
        workDir: '/app',
        stages: [
          { name: 'solo', prompt: 'fly free', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-solo'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);
      expect(pipeline.stages[0].status).toBe('running');
      expect(pipeline.stages[0].sessionId).toBe('s-solo');
      expect(pipeline.stages[0].startedAt).toBeGreaterThan(0);
    });

    it('marks stage failed when createSession throws during advancement', async () => {
      const config: PipelineConfig = {
        name: 'create-fails',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
        ],
      };

      // A starts fine
      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-a'))
        .mockRejectedValue(new Error('tmux full'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Complete A, then advance should try to create B and fail
      sessions.getSession.mockReturnValue(makeMockSession('s-a', { status: 'idle' }));

      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages.find(s => s.name === 'A')?.status).toBe('completed');
      expect(pipeline.stages.find(s => s.name === 'B')?.status).toBe('failed');
      expect(pipeline.stages.find(s => s.name === 'B')?.error).toBe('tmux full');
      expect(pipeline.status).toBe('failed');
    });

    it('retries transient createSession failures and recovers', async () => {
      const config: PipelineConfig = {
        name: 'create-recovers',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-a'))
        .mockRejectedValueOnce(new Error('tmux failed'))
        .mockResolvedValueOnce(makeMockSession('s-b'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Complete A so B can start. B should recover after one transient failure.
      sessions.getSession.mockReturnValue(makeMockSession('s-a', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages.find(s => s.name === 'B')?.status).toBe('running');
      expect(pipeline.status).toBe('running');
    });

    it('does not retry non-retryable createSession failures', async () => {
      const config: PipelineConfig = {
        name: 'create-fatal',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
        ],
      };

      sessions.createSession.mockRejectedValue(new Error('validation failed'));

      const pipeline = await manager.createPipeline(config);

      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toBe('validation failed');
      expect(sessions.createSession).toHaveBeenCalledTimes(1);
      expect(pipeline.status).toBe('failed');
    });

    it('marks stage failed when sendInitialPrompt throws during advancement', async () => {
      const config: PipelineConfig = {
        name: 'prompt-fails',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-a'));
      sessions.sendInitialPrompt.mockRejectedValue(new Error('send failed'));

      const pipeline = await manager.createPipeline(config);

      // createSession succeeded but sendInitialPrompt threw
      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toBe('send failed');
      expect(pipeline.status).toBe('failed');
    });

    // #1805: sendInitialPrompt returns { delivered: false } instead of throwing
    it('marks stage failed when sendInitialPrompt returns delivered=false', async () => {
      const config: PipelineConfig = {
        name: 'prompt-not-delivered',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'do stuff', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-a'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: false, attempts: 3 });

      const pipeline = await manager.createPipeline(config);

      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toMatch(/Failed to deliver initial prompt/);
      expect(pipeline.status).toBe('failed');
    });
  });

  // =========================================================================
  // 4. Polling-based Completion
  // =========================================================================

  describe('polling-based completion', () => {
    it('pollPipelines detects idle session as completed stage', async () => {
      const config: PipelineConfig = {
        name: 'poll-idle',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Session is idle = stage done
      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));

      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('completed');
      expect(pipeline.stages[0].completedAt).toBeGreaterThan(0);
    });

    it('pollPipelines detects disappeared session as failed', async () => {
      const config: PipelineConfig = {
        name: 'poll-gone',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Session vanished
      sessions.getSession.mockReturnValue(null);

      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toBe('Session disappeared');
    });

    it('pollPipelines calls advancePipeline after checking running stages', async () => {
      const config: PipelineConfig = {
        name: 'poll-advance',
        workDir: '/app',
        stages: [
          { name: 'first', prompt: 'a', dependsOn: [] },
          { name: 'second', prompt: 'b', dependsOn: ['first'] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s1'))
        .mockResolvedValueOnce(makeMockSession('s2'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // first goes idle, second should be started by advancePipeline
      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));

      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // advancePipeline should have been called (second stage now running)
      expect(pipeline.stages.find(s => s.name === 'first')?.status).toBe('completed');
      expect(pipeline.stages.find(s => s.name === 'second')?.status).toBe('running');
    });

    it('marks pipeline completed when all stages completed', async () => {
      const config: PipelineConfig = {
        name: 'all-done',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-a'))
        .mockResolvedValueOnce(makeMockSession('s-b'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // A completes
      sessions.getSession.mockImplementation((id: string) => {
        if (id === 's-a') return makeMockSession('s-a', { status: 'idle' });
        return null;
      });
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // B starts and completes
      sessions.getSession.mockImplementation((id: string) => {
        if (id === 's-b') return makeMockSession('s-b', { status: 'idle' });
        return null;
      });
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('completed');
    });

    it('emits emitEnded when pipeline completes (eventBus provided)', async () => {
      const config: PipelineConfig = {
        name: 'emit-test',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('completed');
      expect(eventBus.emitEnded).toHaveBeenCalledWith(pipeline.id, 'pipeline_completed');
    });

    it('does not emit emitEnded when no eventBus is provided', async () => {
      const managerNoBus = new PipelineManager(sessions.mock);

      const config: PipelineConfig = {
        name: 'no-bus',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await managerNoBus.createPipeline(config);

      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));
      await (managerNoBus as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('completed');
      // No crash, no emitEnded call — just succeeds silently
      managerNoBus.destroy();
    });
  });

  // =========================================================================
  // 5. Cleanup Timers
  // =========================================================================

  describe('cleanup timers', () => {
    it('cleans up completed pipeline after 30 seconds', async () => {
      vi.useFakeTimers();

      const config: PipelineConfig = {
        name: 'cleanup-done',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);
      const pipelineId = pipeline.id;

      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('completed');
      expect(manager.getPipeline(pipelineId)).toBeDefined();

      // Advance 30s — cleanup timer should fire
      vi.advanceTimersByTime(30_000);

      expect(manager.getPipeline(pipelineId)).toBeNull();
    });

    it('cleans up failed pipeline after 30 seconds', async () => {
      vi.useFakeTimers();

      const config: PipelineConfig = {
        name: 'cleanup-fail',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);
      const pipelineId = pipeline.id;

      expect(pipeline.status).toBe('running');

      // Session disappears -> stage fails -> pipeline fails
      sessions.getSession.mockReturnValue(null);
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('failed');
      expect(manager.getPipeline(pipelineId)).toBeDefined();

      // Advance 30s — cleanup timer should fire
      vi.advanceTimersByTime(30_000);

      expect(manager.getPipeline(pipelineId)).toBeNull();
    });

    it('cleanup removes from both pipelines and pipelineConfigs maps', async () => {
      vi.useFakeTimers();

      const config: PipelineConfig = {
        name: 'dual-cleanup',
        workDir: '/app',
        stages: [
          { name: 'only', prompt: 'run', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);
      const pipelineId = pipeline.id;

      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // Access private pipelineConfigs to verify cleanup
      const configsMap = (manager as unknown as { pipelineConfigs: Map<string, PipelineConfig> }).pipelineConfigs;

      expect(configsMap.has(pipelineId)).toBe(true);

      vi.advanceTimersByTime(30_000);

      expect(configsMap.has(pipelineId)).toBe(false);
    });
  });

  // =========================================================================
  // 6. batchCreate edge cases
  // =========================================================================

  describe('batchCreate', () => {
    it('returns empty result for empty specs array', async () => {
      const result = await manager.batchCreate([]);

      expect(result).toEqual({
        sessions: [],
        created: 0,
        failed: 0,
        errors: [],
      });
    });

    it('handles all sessions failing', async () => {
      sessions.createSession.mockRejectedValue(new Error('no tmux'));

      const specs: BatchSessionSpec[] = [
        { workDir: '/a', name: 'one', prompt: 'x' },
        { workDir: '/b', name: 'two', prompt: 'y' },
      ];

      const result = await manager.batchCreate(specs);

      expect(result.created).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.sessions).toHaveLength(0);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toBe('no tmux');
      expect(result.errors[1]).toBe('no tmux');
    });

    it('handles partial failure (some succeed, some fail)', async () => {
      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-good', { windowName: 'good-session' }))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(makeMockSession('s-also-good', { windowName: 'also-good' }));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const specs: BatchSessionSpec[] = [
        { workDir: '/a', name: 'one', prompt: 'x' },
        { workDir: '/b', name: 'two', prompt: 'y' },
        { workDir: '/c', name: 'three', prompt: 'z' },
      ];

      const result = await manager.batchCreate(specs);

      expect(result.created).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.sessions).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe('timeout');
    });

    it('counts sendInitialPrompt failure in failed count', async () => {
      sessions.createSession.mockResolvedValue(makeMockSession('s1', { windowName: 'session-1' }));
      sessions.sendInitialPrompt.mockRejectedValue(new Error('prompt failed'));

      const specs: BatchSessionSpec[] = [
        { workDir: '/a', name: 'one', prompt: 'hello' },
      ];

      const result = await manager.batchCreate(specs);

      // createSession succeeded but sendInitialPrompt threw, so the whole spec fails
      expect(result.failed).toBe(1);
      expect(result.created).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe('prompt failed');
    });

    it('skips sendInitialPrompt when no prompt provided', async () => {
      sessions.createSession.mockResolvedValue(makeMockSession('s1', { windowName: 'no-prompt' }));

      const specs: BatchSessionSpec[] = [
        { workDir: '/a', name: 'silent' },
      ];

      const result = await manager.batchCreate(specs);

      expect(result.created).toBe(1);
      expect(result.sessions[0].id).toBe('s1');
      expect(result.sessions[0].name).toBe('no-prompt');
      expect(result.sessions[0].promptDelivery).toBeUndefined();
      expect(sessions.sendInitialPrompt).not.toHaveBeenCalled();
    });

    it('includes promptDelivery in result when prompt is sent', async () => {
      sessions.createSession.mockResolvedValue(makeMockSession('s1', { windowName: 'prompted' }));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 3 });

      const specs: BatchSessionSpec[] = [
        { workDir: '/a', name: 'with-prompt', prompt: 'Do the thing' },
      ];

      const result = await manager.batchCreate(specs);

      expect(result.created).toBe(1);
      expect(result.sessions[0].promptDelivery).toEqual({ delivered: true, attempts: 3 });
    });

    it('handles unknown error without message', async () => {
      sessions.createSession.mockRejectedValue(new Error());

      const specs: BatchSessionSpec[] = [
        { workDir: '/a', name: 'mystery' },
      ];

      const result = await manager.batchCreate(specs);

      expect(result.failed).toBe(1);
      // Error() has empty message — falls back to "Unknown error"
      expect(result.errors[0]).toBe('Unknown error');
    });
  });

  // =========================================================================
  // 7. getPipeline / listPipelines / destroy
  // =========================================================================

  describe('getPipeline / listPipelines / destroy', () => {
    it('getPipeline returns null for unknown id', () => {
      expect(manager.getPipeline('nonexistent')).toBeNull();
    });

    it('getPipeline returns pipeline state after creation', async () => {
      const config: PipelineConfig = {
        name: 'get-test',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const created = await manager.createPipeline(config);
      const retrieved = manager.getPipeline(created.id);

      expect(retrieved).toBe(created);
    });

    it('listPipelines returns all pipelines', async () => {
      const config1: PipelineConfig = {
        name: 'pipeline-1',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
      };
      const config2: PipelineConfig = {
        name: 'pipeline-2',
        workDir: '/app',
        stages: [{ name: 'B', prompt: 'b', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const p1 = await manager.createPipeline(config1);
      const p2 = await manager.createPipeline(config2);

      const all = manager.listPipelines();
      expect(all).toHaveLength(2);

      const ids = all.map(p => p.id);
      expect(ids).toContain(p1.id);
      expect(ids).toContain(p2.id);
    });

    it('listPipelines returns empty array when no pipelines exist', () => {
      expect(manager.listPipelines()).toEqual([]);
    });

    it('destroy clears poll interval', async () => {
      const config: PipelineConfig = {
        name: 'destroy-test',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config);

      // pollInterval should be set now
      const intervalBefore = (manager as unknown as { pollInterval: NodeJS.Timeout | null }).pollInterval;
      expect(intervalBefore).not.toBeNull();

      manager.destroy();

      const intervalAfter = (manager as unknown as { pollInterval: NodeJS.Timeout | null }).pollInterval;
      expect(intervalAfter).toBeNull();
    });

    it('destroy when no poll interval is safe (no-op)', () => {
      // Never created a pipeline, so no poll interval
      const intervalBefore = (manager as unknown as { pollInterval: NodeJS.Timeout | null }).pollInterval;
      expect(intervalBefore).toBeNull();

      // Should not throw
      expect(() => manager.destroy()).not.toThrow();
    });

    it('destroy called twice is safe', async () => {
      const config: PipelineConfig = {
        name: 'double-destroy',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config);

      manager.destroy();
      manager.destroy(); // second call should be safe

      const interval = (manager as unknown as { pollInterval: NodeJS.Timeout | null }).pollInterval;
      expect(interval).toBeNull();
    });
  });

  // =========================================================================
  // 8. Pipeline state shape
  // =========================================================================

  describe('pipeline state shape', () => {
    it('returns correct initial PipelineState shape', async () => {
      const config: PipelineConfig = {
        name: 'shape-test',
        workDir: '/project',
        stages: [
          { name: 'build', prompt: 'build', dependsOn: [] },
          { name: 'test', prompt: 'test', dependsOn: ['build'] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Top-level fields
      expect(pipeline.id).toBeTruthy();
      expect(pipeline.name).toBe('shape-test');
      expect(pipeline.status).toBe('running');
      expect(typeof pipeline.createdAt).toBe('number');
      expect(pipeline.createdAt).toBeGreaterThan(0);

      // Stage shapes
      expect(pipeline.stages).toHaveLength(2);
      expect(pipeline.stages[0]).toEqual({
        name: 'build',
        status: 'running',
        sessionId: 's1',
        dependsOn: [],
        startedAt: expect.any(Number),
      });
      expect(pipeline.stages[1]).toEqual({
        name: 'test',
        status: 'pending',
        dependsOn: ['build'],
      });
    });

    it('preserves per-stage permissionMode and autoApprove', async () => {
      const config: PipelineConfig = {
        name: 'perm-test',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [], permissionMode: 'acceptEdits' },
          { name: 'B', prompt: 'b', dependsOn: ['A'], autoApprove: true },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-a'))
        .mockResolvedValueOnce(makeMockSession('s-b'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config);

      expect(sessions.createSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
        permissionMode: 'acceptEdits',
      }));

      // Complete A to trigger B
      sessions.getSession.mockReturnValue(makeMockSession('s-a', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(sessions.createSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
        autoApprove: true,
      }));
    });
  });

  // =========================================================================
  // 9. Poll interval management
  // =========================================================================

  describe('poll interval management', () => {
    it('sets a 5-second poll interval on first pipeline creation', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setInterval');

      const config: PipelineConfig = {
        name: 'interval-test',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config);

      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
    });

    it('does not create duplicate poll interval for second pipeline', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setInterval');

      const config1: PipelineConfig = {
        name: 'first',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
      };
      const config2: PipelineConfig = {
        name: 'second',
        workDir: '/app',
        stages: [{ name: 'B', prompt: 'b', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config1);
      await manager.createPipeline(config2);

      // setInterval should have been called only once (for the first pipeline)
      expect(setInterval).toHaveBeenCalledTimes(1);
    });

    it('#578: clears poll interval when all pipelines are cleaned up', async () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const config: PipelineConfig = {
        name: 'auto-clear-test',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
      };

      const idleSession = makeMockSession('s1');
      idleSession.status = 'idle';
      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });
      sessions.getSession.mockReturnValue(idleSession);

      await manager.createPipeline(config);

      // Fire a poll tick — session is idle so stage completes, pipeline completes,
      // and the 30s cleanup timer is scheduled
      await vi.advanceTimersByTimeAsync(5_000);

      // Advance past the 30s cleanup delay — interval should be cleared
      await vi.advanceTimersByTimeAsync(30_000);

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('#578: restarts poll interval when pipeline is added after interval cleared', async () => {
      vi.useFakeTimers();
      vi.spyOn(global, 'setInterval');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const config1: PipelineConfig = {
        name: 'first',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'a', dependsOn: [] }],
      };
      const config2: PipelineConfig = {
        name: 'second',
        workDir: '/app',
        stages: [{ name: 'B', prompt: 'b', dependsOn: [] }],
      };

      const idleSession = makeMockSession('s1');
      idleSession.status = 'idle';
      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });
      sessions.getSession.mockReturnValue(idleSession);

      // Create first pipeline, let it complete and clean up
      await manager.createPipeline(config1);
      expect(setInterval).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(clearIntervalSpy).toHaveBeenCalled();

      // Create second pipeline — interval should be restarted
      await manager.createPipeline(config2);

      expect(setInterval).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // 10. Stage Timeout (#1423)
  // =========================================================================

  describe('stage timeout', () => {
    it('marks stage failed when stageTimeoutMs is exceeded', async () => {
      vi.useFakeTimers();

      const config: PipelineConfig = {
        name: 'timeout-test',
        workDir: '/app',
        stages: [
          { name: 'slow', prompt: 'run slow', dependsOn: [], stageTimeoutMs: 60_000 },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-slow'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      expect(pipeline.stages[0].status).toBe('running');
      expect(pipeline.stages[0].startedAt).toBeGreaterThan(0);

      // Session is still working (not idle)
      sessions.getSession.mockReturnValue(makeMockSession('s-slow', { status: 'working' }));

      // Advance past the timeout
      vi.advanceTimersByTime(61_000);
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toBe('stage_timeout');
      expect(pipeline.status).toBe('failed');
    });

    it('does not mark stage failed before timeout elapses', async () => {
      vi.useFakeTimers();

      const config: PipelineConfig = {
        name: 'no-timeout-yet',
        workDir: '/app',
        stages: [
          { name: 'slow', prompt: 'run slow', dependsOn: [], stageTimeoutMs: 120_000 },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-slow'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      sessions.getSession.mockReturnValue(makeMockSession('s-slow', { status: 'working' }));

      // Advance only 30s — well within the 120s timeout
      vi.advanceTimersByTime(30_000);
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('running');
    });

    it('ignores timeout when stageTimeoutMs is not set', async () => {
      vi.useFakeTimers();

      const config: PipelineConfig = {
        name: 'no-timeout-config',
        workDir: '/app',
        stages: [
          { name: 'slow', prompt: 'run slow', dependsOn: [] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-slow'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      sessions.getSession.mockReturnValue(makeMockSession('s-slow', { status: 'working' }));

      // Advance a very long time — should NOT time out without config
      vi.advanceTimersByTime(1_000_000);
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('running');
    });

    it('does not time out a stage that completes before the timeout', async () => {
      vi.useFakeTimers();

      const config: PipelineConfig = {
        name: 'completes-first',
        workDir: '/app',
        stages: [
          { name: 'fast', prompt: 'run fast', dependsOn: [], stageTimeoutMs: 60_000 },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-fast'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Session goes idle before timeout
      sessions.getSession.mockReturnValue(makeMockSession('s-fast', { status: 'idle' }));

      vi.advanceTimersByTime(5_000);
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('completed');
      expect(pipeline.status).toBe('completed');
    });

    it('uses global defaultStageTimeoutMs when per-stage timeout is not set', async () => {
      vi.useFakeTimers();

      // Create manager with a global default of 90s
      const defaultManager = new PipelineManager(sessions.mock, eventBus.mock, undefined, 90_000);

      const config: PipelineConfig = {
        name: 'default-timeout',
        workDir: '/app',
        stages: [
          { name: 'slow', prompt: 'run slow', dependsOn: [] },
          // No stageTimeoutMs — should use global default of 90s
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-slow'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await defaultManager.createPipeline(config);

      sessions.getSession.mockReturnValue(makeMockSession('s-slow', { status: 'working' }));

      // Advance past the 90s global default
      vi.advanceTimersByTime(91_000);
      await (defaultManager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toBe('stage_timeout');

      await defaultManager.destroy();
    });

    it('per-stage timeout overrides global defaultStageTimeoutMs', async () => {
      vi.useFakeTimers();

      // Global default is 30s, but per-stage is 120s
      const defaultManager = new PipelineManager(sessions.mock, eventBus.mock, undefined, 30_000);

      const config: PipelineConfig = {
        name: 'override-timeout',
        workDir: '/app',
        stages: [
          { name: 'slow', prompt: 'run slow', dependsOn: [], stageTimeoutMs: 120_000 },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-slow'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await defaultManager.createPipeline(config);

      sessions.getSession.mockReturnValue(makeMockSession('s-slow', { status: 'working' }));

      // Advance past global default (30s) but not per-stage (120s)
      vi.advanceTimersByTime(31_000);
      await (defaultManager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // Should still be running — per-stage timeout takes precedence
      expect(pipeline.stages[0].status).toBe('running');

      // Now advance past per-stage timeout
      vi.advanceTimersByTime(90_000);
      await (defaultManager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toBe('stage_timeout');

      await defaultManager.destroy();
    });

    it('timeout wins over idle when both are true at the same poll check', async () => {
      vi.useFakeTimers();

      // Use a very short timeout so timeout fires on the first poll
      const config: PipelineConfig = {
        name: 'timeout-over-idle',
        workDir: '/app',
        stages: [
          { name: 'slow', prompt: 'run slow', dependsOn: [], stageTimeoutMs: 3_000 },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-slow'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Session is idle AND timed out — timeout should win at the same poll
      sessions.getSession.mockReturnValue(makeMockSession('s-slow', { status: 'idle' }));

      // Advance past the 3s timeout to the first poll at ~5s
      vi.advanceTimersByTime(5_000);
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // Should be failed (timeout wins over idle)
      expect(pipeline.stages[0].status).toBe('failed');
      expect(pipeline.stages[0].error).toBe('stage_timeout');
    });
  });

  // =========================================================================
  // 11. Multi-stage pipeline integration scenarios
  // =========================================================================

  describe('multi-stage integration', () => {
    it('advances through full pipeline: A -> B -> C', async () => {
      const config: PipelineConfig = {
        name: 'full-run',
        workDir: '/app',
        stages: [
          { name: 'build', prompt: 'build', dependsOn: [] },
          { name: 'test', prompt: 'test', dependsOn: ['build'] },
          { name: 'deploy', prompt: 'deploy', dependsOn: ['test'] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-build'))
        .mockResolvedValueOnce(makeMockSession('s-test'))
        .mockResolvedValueOnce(makeMockSession('s-deploy'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);
      expect(pipeline.stages[0].status).toBe('running');
      expect(pipeline.stages[1].status).toBe('pending');
      expect(pipeline.stages[2].status).toBe('pending');

      // Build completes
      sessions.getSession.mockReturnValue(makeMockSession('s-build', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('completed');
      expect(pipeline.stages[1].status).toBe('running');
      expect(pipeline.stages[2].status).toBe('pending');

      // Test completes
      sessions.getSession.mockReturnValue(makeMockSession('s-test', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[1].status).toBe('completed');
      expect(pipeline.stages[2].status).toBe('running');

      // Deploy completes
      sessions.getSession.mockReturnValue(makeMockSession('s-deploy', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[2].status).toBe('completed');
      expect(pipeline.status).toBe('completed');
      expect(eventBus.emitEnded).toHaveBeenCalledWith(pipeline.id, 'pipeline_completed');
    });

    it('handles parallel stages completing independently', async () => {
      const config: PipelineConfig = {
        name: 'parallel',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: [] },
          { name: 'C', prompt: 'c', dependsOn: ['A', 'B'] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-a'))
        .mockResolvedValueOnce(makeMockSession('s-b'))
        .mockResolvedValueOnce(makeMockSession('s-c'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Both A and B running, C pending
      expect(pipeline.stages[0].status).toBe('running');
      expect(pipeline.stages[1].status).toBe('running');
      expect(pipeline.stages[2].status).toBe('pending');

      // A completes, B still running
      sessions.getSession.mockImplementation((id: string) => {
        if (id === 's-a') return makeMockSession('s-a', { status: 'idle' });
        if (id === 's-b') return makeMockSession('s-b', { status: 'working' });
        return null;
      });
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[0].status).toBe('completed');
      expect(pipeline.stages[1].status).toBe('running');
      expect(pipeline.stages[2].status).toBe('pending'); // Still waiting on B

      // B completes, C can now start
      sessions.getSession.mockImplementation((id: string) => {
        if (id === 's-a') return makeMockSession('s-a', { status: 'idle' });
        if (id === 's-b') return makeMockSession('s-b', { status: 'idle' });
        return null;
      });
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages[1].status).toBe('completed');
      expect(pipeline.stages[2].status).toBe('running');
    });

    it('fails entire pipeline when intermediate stage fails', async () => {
      const config: PipelineConfig = {
        name: 'mid-fail',
        workDir: '/app',
        stages: [
          { name: 'A', prompt: 'a', dependsOn: [] },
          { name: 'B', prompt: 'b', dependsOn: ['A'] },
          { name: 'C', prompt: 'c', dependsOn: ['B'] },
        ],
      };

      sessions.createSession
        .mockResolvedValueOnce(makeMockSession('s-a'))
        .mockResolvedValueOnce(makeMockSession('s-b'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // A completes, B starts
      sessions.getSession.mockReturnValue(makeMockSession('s-a', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // B's session disappears (fails)
      sessions.getSession.mockImplementation((id: string) => {
        if (id === 's-b') return null;
        return makeMockSession('s-a', { status: 'idle' });
      });
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.stages.find(s => s.name === 'B')?.status).toBe('failed');
      expect(pipeline.status).toBe('failed');
      // C never started
      expect(pipeline.stages.find(s => s.name === 'C')?.status).toBe('pending');
    });
  });

  // =========================================================================
  // 12. Pipeline Persistence (#1424)
  // =========================================================================

  describe('pipeline persistence (#1424, #1938)', () => {
    let tmpDir: string;
    let store: JsonFileStore;

    beforeEach(async () => {
      tmpDir = join(os.tmpdir(), `aegis-test-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await mkdir(tmpDir, { recursive: true });
      store = new JsonFileStore({ stateDir: tmpDir });
      await store.start();
    });

    afterEach(async () => {
      await store.stop(AbortSignal.timeout(1000)).catch(() => {});
      await import('node:fs/promises').then(fs => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}));
    });

    it('persists running pipeline to store on creation', async () => {
      const manager = new PipelineManager(sessions.mock, eventBus.mock, store);
      const config: PipelineConfig = {
        name: 'persist-test',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'run a', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-a'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config);

      const pipelineState = await store.loadPipelines();
      const ids = Object.keys(pipelineState.pipelines);
      expect(ids).toHaveLength(1);

      const entry = pipelineState.pipelines[ids[0]!]!;
      expect(entry.state.name).toBe('persist-test');
      expect(entry.state.status).toBe('running');
      expect(entry.config).toBeDefined();
      expect(entry.config!.stages[0].prompt).toBe('run a');

      await manager.destroy();
    });

    it('deletes stored state when all pipelines complete', async () => {
      const manager = new PipelineManager(sessions.mock, eventBus.mock, store);
      const config: PipelineConfig = {
        name: 'complete-test',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'run a', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-a'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });
      sessions.getSession.mockReturnValue(makeMockSession('s-a', { status: 'idle' }));

      await manager.createPipeline(config);

      // Pipeline exists in store after creation
      let ids = await store.listPipelineIds();
      expect(ids).toHaveLength(1);

      // Poll to detect completion
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      // Pipeline completed — store should be empty
      ids = await store.listPipelineIds();
      expect(ids).toHaveLength(0);

      await manager.destroy();
    });

    it('hydrates running pipelines from store on startup', async () => {
      // First: create a pipeline and let it persist
      const config: PipelineConfig = {
        name: 'hydrate-test',
        workDir: '/app',
        stages: [
          { name: 'build', prompt: 'build it', dependsOn: [] },
          { name: 'test', prompt: 'test it', dependsOn: ['build'] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-build'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const manager1 = new PipelineManager(sessions.mock, eventBus.mock, store);
      const original = await manager1.createPipeline(config);
      await manager1.destroy();

      // Second: simulate server restart — new manager hydrates from same store
      sessions.getSession.mockReturnValue(makeMockSession('s-build', { status: 'working' }));
      const manager2 = new PipelineManager(sessions.mock, eventBus.mock, store);
      const recovered = await manager2.hydrate();

      expect(recovered).toBe(1);
      const restored = manager2.getPipeline(original.id);
      expect(restored).not.toBeNull();
      expect(restored!.name).toBe('hydrate-test');
      expect(restored!.status).toBe('running');
      expect(restored!.stages[0].status).toBe('running');
      expect(restored!.stages[1].status).toBe('pending');

      // Config should also be restored
      const configs = (manager2 as unknown as { pipelineConfigs: Map<string, PipelineConfig> }).pipelineConfigs;
      expect(configs.get(original.id)).toBeDefined();
      expect(configs.get(original.id)!.stages[1].prompt).toBe('test it');

      await manager2.destroy();
    });

    it('marks orphaned stages as failed during hydration', async () => {
      // Persist a pipeline with a running stage
      const config: PipelineConfig = {
        name: 'orphan-test',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'run a', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-gone'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const manager1 = new PipelineManager(sessions.mock, eventBus.mock, store);
      await manager1.createPipeline(config);
      await manager1.destroy();

      // Restart: session no longer exists
      sessions.getSession.mockReturnValue(null);

      const manager2 = new PipelineManager(sessions.mock, eventBus.mock, store);
      const recovered = await manager2.hydrate();

      expect(recovered).toBe(1);
      const restored = manager2.getPipeline(
        (manager2.listPipelines()[0]).id,
      );
      expect(restored!.status).toBe('failed');
      expect(restored!.stages[0].status).toBe('failed');
      expect(restored!.stages[0].error).toBe('Session disappeared during server restart');

      await manager2.destroy();
    });

    it('returns 0 when store has no pipelines', async () => {
      const manager = new PipelineManager(sessions.mock, eventBus.mock, store);
      const recovered = await manager.hydrate();
      expect(recovered).toBe(0);
      await manager.destroy();
    });

    it('returns 0 when store data is corrupt', async () => {
      // Write corrupt data to the pipelines.json file
      await writeFile(join(tmpDir, 'pipelines.json'), 'not json{{', 'utf-8');

      const manager = new PipelineManager(sessions.mock, eventBus.mock, store);
      const recovered = await manager.hydrate();
      expect(recovered).toBe(0);
      await manager.destroy();
    });

    it('skips malformed entries during hydration', async () => {
      // Write legacy array format with malformed entries
      await writeFile(join(tmpDir, 'pipelines.json'), JSON.stringify([
        { id: 'good', name: 'good', status: 'running', stages: [{ name: 'A', status: 'pending', dependsOn: [] }], stageHistory: [], createdAt: Date.now(), currentStage: 'plan', retryCount: 0, maxRetries: 3 },
        { id: 'bad', name: 'bad' },  // missing stages array
        'not-an-object',
        null,
      ]), 'utf-8');

      const manager = new PipelineManager(sessions.mock, eventBus.mock, store);
      const recovered = await manager.hydrate();
      expect(recovered).toBe(1);
      expect(manager.listPipelines()).toHaveLength(1);
      expect(manager.listPipelines()[0].name).toBe('good');
      await manager.destroy();
    });

    it('does not persist when no store is provided', async () => {
      const manager = new PipelineManager(sessions.mock, eventBus.mock, undefined);
      const config: PipelineConfig = {
        name: 'no-store',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'run', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await manager.createPipeline(config);
      // No crash, nothing written to store
      const ids = await store.listPipelineIds();
      expect(ids).toHaveLength(0);
      await manager.destroy();
    });

    it('fails creation when store throws on write', async () => {
      // Create a store backed by a non-existent directory to force write failures
      const badStore = new JsonFileStore({ stateDir: '/nonexistent/path/that/does/not/exist' });
      const manager = new PipelineManager(sessions.mock, eventBus.mock, badStore);
      const config: PipelineConfig = {
        name: 'bad-store',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'run', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      await expect(manager.createPipeline(config)).rejects.toThrow(
        /Failed to persist pipeline state on creation:/,
      );

      await manager.destroy();
    });

    it('marks running pipeline as failed when persistence later fails', async () => {
      // Use a store that starts working but will fail after creation
      const flakyStore = new JsonFileStore({ stateDir: tmpDir });
      await flakyStore.start();

      const manager = new PipelineManager(sessions.mock, eventBus.mock, flakyStore);
      const config: PipelineConfig = {
        name: 'runtime-persist-fail',
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'run', dependsOn: [] }],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s1'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const pipeline = await manager.createPipeline(config);

      // Force a persistence failure by replacing the store with one that throws
      const throwingStore = new JsonFileStore({ stateDir: '/nonexistent/path/that/does/not/exist' });
      (manager as unknown as { store: JsonFileStore }).store = throwingStore;

      sessions.getSession.mockReturnValue(makeMockSession('s1', { status: 'idle' }));
      await (manager as unknown as { pollPipelines: () => Promise<void> }).pollPipelines();

      expect(pipeline.status).toBe('failed');
      expect(pipeline.currentStage).toBe('fix');
      const stage = pipeline.stages.find(s => s.name === 'A');
      expect(stage?.status).toBe('completed');
      const persistenceFailureOutput = pipeline.stageHistory
        .map(history => history.output)
        .find(output => {
          if (!output || typeof output !== 'object') return false;
          return Reflect.get(output, 'reason') === 'persistence_failed';
        });
      expect(persistenceFailureOutput).toBeDefined();

      await flakyStore.stop(AbortSignal.timeout(1000)).catch(() => {});
      await manager.destroy();
    });

    it('#1938: resumes pipeline after restart with full stage history (no audit loss)', async () => {
      // Create a pipeline, let it progress, then simulate restart
      const config: PipelineConfig = {
        name: 'audit-test',
        workDir: '/app',
        stages: [
          { name: 'build', prompt: 'build it', dependsOn: [] },
          { name: 'test', prompt: 'test it', dependsOn: ['build'] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-build'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const manager1 = new PipelineManager(sessions.mock, eventBus.mock, store);
      const pipeline1 = await manager1.createPipeline(config);

      // Capture the stage history before shutdown
      const historyBefore = [...pipeline1.stageHistory];
      expect(historyBefore.length).toBeGreaterThanOrEqual(2); // plan + execute at minimum

      await manager1.destroy();

      // Simulate restart — session still running
      sessions.getSession.mockReturnValue(makeMockSession('s-build', { status: 'working' }));
      const manager2 = new PipelineManager(sessions.mock, eventBus.mock, store);
      const recovered = await manager2.hydrate();

      expect(recovered).toBe(1);
      const restored = manager2.getPipeline(pipeline1.id);
      expect(restored).not.toBeNull();
      expect(restored!.stageHistory).toHaveLength(historyBefore.length);

      // Every audit transition must survive the round-trip
      for (let i = 0; i < historyBefore.length; i++) {
        expect(restored!.stageHistory[i]!.stage).toBe(historyBefore[i]!.stage);
        expect(restored!.stageHistory[i]!.enteredAt).toBe(historyBefore[i]!.enteredAt);
      }

      await manager2.destroy();
    });

    it('#1938: restart mid-run preserves running stage state', async () => {
      // Create a pipeline with a running stage
      const config: PipelineConfig = {
        name: 'mid-run-test',
        workDir: '/app',
        stages: [
          { name: 'build', prompt: 'build it', dependsOn: [] },
          { name: 'test', prompt: 'test it', dependsOn: ['build'] },
        ],
      };

      sessions.createSession.mockResolvedValue(makeMockSession('s-build'));
      sessions.sendInitialPrompt.mockResolvedValue({ delivered: true, attempts: 1 });

      const manager1 = new PipelineManager(sessions.mock, eventBus.mock, store);
      const pipeline1 = await manager1.createPipeline(config);

      // Build stage should be running
      expect(pipeline1.stages[0].status).toBe('running');
      expect(pipeline1.stages[0].sessionId).toBe('s-build');
      expect(pipeline1.stages[1].status).toBe('pending');

      await manager1.destroy();

      // Simulate restart — session still alive
      sessions.getSession.mockReturnValue(makeMockSession('s-build', { status: 'working' }));
      const manager2 = new PipelineManager(sessions.mock, eventBus.mock, store);
      const recovered = await manager2.hydrate();

      expect(recovered).toBe(1);
      const restored = manager2.getPipeline(pipeline1.id);
      expect(restored).not.toBeNull();

      // Build stage still running with same session
      expect(restored!.stages[0].status).toBe('running');
      expect(restored!.stages[0].sessionId).toBe('s-build');
      expect(restored!.stages[1].status).toBe('pending');

      // Pipeline should resume polling
      expect(restored!.status).toBe('running');

      await manager2.destroy();
    });
  });
});

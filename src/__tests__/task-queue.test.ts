/**
 * __tests__/task-queue.test.ts — Task queue unit tests.
 *
 * Tests the full task lifecycle: enqueue → claim → start → complete/fail → retry.
 * Uses a real PostgreSQL connection for integration-level testing.
 *
 * Run with: vitest run task-queue
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PostgresTaskStore } from '../services/task-queue/store.js';
import { TaskService } from '../services/task-queue/service.js';
import type { TaskRecord, TaskEvent } from '../services/task-queue/types.js';
import { isTerminalStatus, priorityToNumber, parseFailureReason } from '../services/task-queue/types.js';

// Skip tests if no Postgres URL is configured
const pgUrl = process.env.AEGIS_POSTGRES_URL ?? process.env.TEST_POSTGRES_URL ?? '';
const skipIfNoDb = pgUrl ? describe : describe.skip;

// Use a test-specific table to avoid polluting production data
const TEST_TABLE = `test_tasks_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

skipIfNoDb('Task Queue', () => {
  let store: PostgresTaskStore;
  let service: TaskService;

  beforeAll(async () => {
    store = new PostgresTaskStore({
      url: pgUrl,
      tableName: TEST_TABLE,
      poolMax: 2,
    });
    await store.start();
  });

  afterAll(async () => {
    // Clean up test table
    try {
      await store['pool'].query(`DROP TABLE IF EXISTS "public"."${TEST_TABLE}"`);
    } catch { /* ignore */ }
    await store.stop();
  });

  beforeEach(async () => {
    // Truncate table between tests
    try {
      await store['pool'].query(`TRUNCATE "public"."${TEST_TABLE}"`);
    } catch { /* ignore */ }

    service = new TaskService(store, undefined, {
      maxConcurrentPerAgent: 2,
      autoRetryEnabled: true,
      defaultMaxAttempts: 3,
    });
  });

  describe('types', () => {
    it('priorityToNumber orders correctly', () => {
      expect(priorityToNumber('urgent')).toBeGreaterThan(priorityToNumber('high'));
      expect(priorityToNumber('high')).toBeGreaterThan(priorityToNumber('normal'));
      expect(priorityToNumber('normal')).toBeGreaterThan(priorityToNumber('low'));
    });

    it('parseFailureReason classifies known reasons', () => {
      expect(parseFailureReason('timeout')).toBe('timeout');
      expect(parseFailureReason('runtime_offline')).toBe('runtime_offline');
      expect(parseFailureReason('nonsense')).toBe('unknown');
    });

    it('isTerminalStatus identifies terminal states', () => {
      expect(isTerminalStatus('completed')).toBe(true);
      expect(isTerminalStatus('failed')).toBe(true);
      expect(isTerminalStatus('cancelled')).toBe(true);
      expect(isTerminalStatus('queued')).toBe(false);
      expect(isTerminalStatus('running')).toBe(false);
    });
  });

  describe('TaskService.enqueue', () => {
    it('creates a queued task with defaults', async () => {
      const task = await service.enqueue({ agentId: 'agent-1' });

      expect(task.id).toBeTruthy();
      expect(task.agentId).toBe('agent-1');
      expect(task.status).toBe('queued');
      expect(task.priority).toBe('normal');
      expect(task.attempt).toBe(1);
      expect(task.maxAttempts).toBe(3);
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.forceFreshSession).toBe(false);
    });

    it('creates a high-priority task with custom params', async () => {
      const task = await service.enqueue({
        agentId: 'agent-1',
        priority: 'urgent',
        prompt: 'Fix the bug in auth.ts',
        maxAttempts: 5,
        issueId: 'issue-123',
        forceFreshSession: true,
      });

      expect(task.priority).toBe('urgent');
      expect(task.prompt).toBe('Fix the bug in auth.ts');
      expect(task.maxAttempts).toBe(5);
      expect(task.issueId).toBe('issue-123');
      expect(task.forceFreshSession).toBe(true);
    });
  });

  describe('Task lifecycle: enqueue → claim → start → complete', () => {
    it('transitions through the full happy path', async () => {
      // Enqueue
      const queued = await service.enqueue({ agentId: 'agent-1', issueId: 'issue-1' });
      expect(queued.status).toBe('queued');

      // Claim
      const dispatched = await service.claim('agent-1', 'runtime-1');
      expect(dispatched).toBeTruthy();
      expect(dispatched!.status).toBe('dispatched');
      expect(dispatched!.runtimeId).toBe('runtime-1');
      expect(dispatched!.id).toBe(queued.id);

      // Start
      const running = await service.start(dispatched!.id);
      expect(running).toBeTruthy();
      expect(running!.status).toBe('running');

      // Complete
      const completed = await service.complete({
        taskId: running!.id,
        result: { output: 'Bug fixed!' },
        sessionId: 'sess-123',
        workDir: '/tmp/project',
      });
      expect(completed).toBeTruthy();
      expect(completed!.status).toBe('completed');
      expect(completed!.result).toEqual({ output: 'Bug fixed!' });
      expect(completed!.sessionId).toBe('sess-123');
      expect(completed!.workDir).toBe('/tmp/project');
    });
  });

  describe('Task failure and retry', () => {
    it('fails a running task and auto-retries for retryable reasons', async () => {
      const queued = await service.enqueue({ agentId: 'agent-1', issueId: 'issue-1', maxAttempts: 3 });
      const dispatched = await service.claim('agent-1', 'runtime-1');
      await service.start(dispatched!.id);

      // Fail with retryable reason
      const { task: failed, retried } = await service.fail({
        taskId: dispatched!.id,
        error: 'Agent timed out',
        failureReason: 'timeout',
      });

      expect(failed.status).toBe('failed');
      expect(failed.failureReason).toBe('timeout');
      expect(retried).toBeTruthy();
      expect(retried!.status).toBe('queued');
      expect(retried!.attempt).toBe(2);
      expect(retried!.issueId).toBe('issue-1');
    });

    it('does NOT retry for non-retryable reasons', async () => {
      const queued = await service.enqueue({ agentId: 'agent-1', issueId: 'issue-1', maxAttempts: 3 });
      const dispatched = await service.claim('agent-1', 'runtime-1');
      await service.start(dispatched!.id);

      const { task: failed, retried } = await service.fail({
        taskId: dispatched!.id,
        error: 'User cancelled',
        failureReason: 'cancelled',
      });

      expect(failed.status).toBe('failed');
      expect(retried).toBeNull();
    });

    it('does NOT retry after max attempts', async () => {
      const queued = await service.enqueue({ agentId: 'agent-1', issueId: 'issue-1', maxAttempts: 1 });
      const dispatched = await service.claim('agent-1', 'runtime-1');
      await service.start(dispatched!.id);

      const { task: failed, retried } = await service.fail({
        taskId: dispatched!.id,
        error: 'Agent error',
        failureReason: 'agent_error',
      });

      expect(failed.status).toBe('failed');
      expect(retried).toBeNull();
    });
  });

  describe('Task cancellation', () => {
    it('cancels a queued task', async () => {
      const task = await service.enqueue({ agentId: 'agent-1' });
      const cancelled = await service.cancel(task.id);

      expect(cancelled).toBeTruthy();
      expect(cancelled!.status).toBe('cancelled');
    });

    it('cancels all tasks for an issue', async () => {
      await service.enqueue({ agentId: 'agent-1', issueId: 'issue-x' });
      await service.enqueue({ agentId: 'agent-1', issueId: 'issue-x' });
      await service.enqueue({ agentId: 'agent-1', issueId: 'issue-y' });

      const cancelled = await service.cancelForIssue('issue-x');
      expect(cancelled.length).toBe(2);
      expect(cancelled.every(t => t.status === 'cancelled')).toBe(true);
    });
  });

  describe('Claim logic', () => {
    it('claims highest priority first', async () => {
      await service.enqueue({ agentId: 'agent-1', priority: 'low' });
      await service.enqueue({ agentId: 'agent-1', priority: 'urgent' });
      await service.enqueue({ agentId: 'agent-1', priority: 'normal' });

      const claimed = await service.claim('agent-1');
      expect(claimed).toBeTruthy();
      expect(claimed!.priority).toBe('urgent');
    });

    it('returns null when no tasks available', async () => {
      const claimed = await service.claim('agent-1');
      expect(claimed).toBeNull();
    });

    it('returns null when agent is at capacity', async () => {
      // Fill up capacity (maxConcurrentPerAgent = 2)
      const t1 = await service.enqueue({ agentId: 'agent-1' });
      const t2 = await service.enqueue({ agentId: 'agent-1' });
      await service.claim('agent-1');
      await service.claim('agent-1');

      // Add a third task and try to claim
      const t3 = await service.enqueue({ agentId: 'agent-1' });
      const claimed = await service.claim('agent-1');

      // Should still be null — at capacity
      expect(claimed).toBeNull();
    });
  });

  describe('Orphan recovery', () => {
    it('recovers orphaned tasks for a runtime', async () => {
      const t1 = await service.enqueue({ agentId: 'agent-1', issueId: 'issue-orphan' });
      const dispatched = await service.claim('agent-1', 'runtime-1');
      await service.start(dispatched!.id);

      const { recovered, retried } = await service.recoverOrphans('runtime-1');
      expect(recovered.length).toBe(1);
      expect(recovered[0].status).toBe('failed');
      expect(recovered[0].failureReason).toBe('runtime_recovery');
      expect(retried.length).toBe(1);
      expect(retried[0].status).toBe('queued');
    });
  });

  describe('Session pinning', () => {
    it('pins session info on a task', async () => {
      const task = await service.enqueue({ agentId: 'agent-1' });
      const dispatched = await service.claim('agent-1');
      await service.start(dispatched!.id);

      const pinned = await service.pinSession(dispatched!.id, 'sess-abc', '/workdir');
      expect(pinned).toBeTruthy();
      expect(pinned!.sessionId).toBe('sess-abc');
      expect(pinned!.workDir).toBe('/workdir');
    });
  });

  describe('Task events', () => {
    it('emits events for each state transition', async () => {
      const events: TaskEvent[] = [];
      const unsub = service.onTaskEvent(e => events.push(e));

      const task = await service.enqueue({ agentId: 'agent-1' });
      expect(events.find(e => e.type === 'task:queued')).toBeTruthy();

      const dispatched = await service.claim('agent-1');
      expect(events.find(e => e.type === 'task:dispatched')).toBeTruthy();

      await service.start(dispatched!.id);
      expect(events.find(e => e.type === 'task:started')).toBeTruthy();

      await service.complete({ taskId: dispatched!.id, result: { ok: true } });
      expect(events.find(e => e.type === 'task:completed')).toBeTruthy();

      expect(events.length).toBe(4);
      unsub();
    });
  });

  describe('Listing and filtering', () => {
    it('lists tasks with filters', async () => {
      await service.enqueue({ agentId: 'agent-1', issueId: 'issue-1', priority: 'high' });
      await service.enqueue({ agentId: 'agent-2', issueId: 'issue-2', priority: 'low' });

      const all = await service.list({});
      expect(all.total).toBe(2);

      const filtered = await service.list({ agentId: 'agent-1' });
      expect(filtered.total).toBe(1);
      expect(filtered.tasks[0].agentId).toBe('agent-1');

      const byStatus = await service.list({ status: 'queued' });
      expect(byStatus.total).toBe(2);
    });

    it('counts tasks by status', async () => {
      await service.enqueue({ agentId: 'agent-1' });
      await service.enqueue({ agentId: 'agent-1' });
      const t = await service.enqueue({ agentId: 'agent-1' });
      await service.cancel(t.id);

      const counts = await service.countByStatus('agent-1');
      expect(counts.queued).toBe(2);
      expect(counts.cancelled).toBe(1);
    });
  });
});

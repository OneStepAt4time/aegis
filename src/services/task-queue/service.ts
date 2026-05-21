/**
 * services/task-queue/service.ts — Task queue business logic.
 *
 * Ported from Multica's TaskService. Manages the task lifecycle:
 * enqueue → claim → start → complete/fail → (retry).
 *
 * Emits events on the Aegis event bus for real-time updates.
 * Auto-retry for transient failures (runtime_offline, timeout).
 */

import type { SessionEventBus } from '../../events.js';
import { PostgresTaskStore } from './store.js';
import type {
  TaskRecord,
  CreateTaskParams,
  CompleteTaskParams,
  FailTaskParams,
  TaskListFilters,
  TaskFailureReason,
  TaskEventType,
  TaskEvent,
} from './types.js';
import { RETRYABLE_REASONS, isTerminalStatus } from './types.js';

/** Callback for task state changes. */
export type TaskEventCallback = (event: TaskEvent) => void;

/** Configuration for the task service. */
export interface TaskServiceConfig {
  /** Maximum concurrent tasks per agent. */
  maxConcurrentPerAgent?: number;
  /** Whether auto-retry is enabled. */
  autoRetryEnabled?: boolean;
  /** Default max attempts for new tasks. */
  defaultMaxAttempts?: number;
}

const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_AUTO_RETRY = true;
const DEFAULT_MAX_ATTEMPTS = 3;

export class TaskService {
  private readonly store: PostgresTaskStore;
  private readonly eventBus?: SessionEventBus;
  private readonly config: Required<TaskServiceConfig>;
  private readonly listeners: Set<TaskEventCallback> = new Set();

  constructor(
    store: PostgresTaskStore,
    eventBus?: SessionEventBus,
    config?: TaskServiceConfig,
  ) {
    this.store = store;
    this.eventBus = eventBus;
    this.config = {
      maxConcurrentPerAgent: config?.maxConcurrentPerAgent ?? DEFAULT_MAX_CONCURRENT,
      autoRetryEnabled: config?.autoRetryEnabled ?? DEFAULT_AUTO_RETRY,
      defaultMaxAttempts: config?.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    };
  }

  /** Subscribe to task events. */
  onTaskEvent(callback: TaskEventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Emit a task event to listeners and the event bus. */
  private emit(type: TaskEventType, task: TaskRecord): void {
    const event: TaskEvent = { type, task, timestamp: new Date() };
    for (const cb of this.listeners) {
      try { cb(event); } catch { /* listener errors don't break the service */ }
    }
    // Also emit on the global event bus if available
    if (this.eventBus) {
      this.eventBus.emit(type as any, event as any);
    }
  }

  /** Enqueue a new task. */
  async enqueue(params: CreateTaskParams): Promise<TaskRecord> {
    const task = await this.store.createTask({
      ...params,
      maxAttempts: params.maxAttempts ?? this.config.defaultMaxAttempts,
    });
    this.emit('task:queued', task);
    return task;
  }

  /** Claim the next task for an agent. */
  async claim(agentId: string, runtimeId?: string): Promise<TaskRecord | null> {
    const task = await this.store.claimTask(agentId, runtimeId);
    if (task) {
      this.emit('task:dispatched', task);
    }
    return task;
  }

  /** Start a dispatched task. */
  async start(taskId: string): Promise<TaskRecord | null> {
    const task = await this.store.startTask(taskId);
    if (task) {
      this.emit('task:started', task);
    }
    return task;
  }

  /** Complete a running task. */
  async complete(params: CompleteTaskParams): Promise<TaskRecord | null> {
    const task = await this.store.completeTask(params);
    if (task) {
      this.emit('task:completed', task);
    }
    return task;
  }

  /** Fail a running task. Triggers auto-retry if eligible. */
  async fail(params: FailTaskParams): Promise<{ task: TaskRecord; retried: TaskRecord | null }> {
    const task = await this.store.failTask(params);
    if (!task) {
      return { task: null!, retried: null };
    }

    this.emit('task:failed', task);

    // Auto-retry for eligible failures
    let retried: TaskRecord | null = null;
    if (this.config.autoRetryEnabled && this.shouldRetry(task)) {
      retried = await this.retry(task.id);
      if (retried) {
        this.emit('task:retrying', retried);
      }
    }

    return { task, retried };
  }

  /** Cancel a task. */
  async cancel(taskId: string): Promise<TaskRecord | null> {
    const task = await this.store.cancelTask(taskId);
    if (task) {
      this.emit('task:cancelled', task);
    }
    return task;
  }

  /** Cancel all tasks for an issue. */
  async cancelForIssue(issueId: string): Promise<TaskRecord[]> {
    const tasks = await this.store.cancelTasksForIssue(issueId);
    for (const task of tasks) {
      this.emit('task:cancelled', task);
    }
    return tasks;
  }

  /** Retry a failed task. Creates a new row with incremented attempt. */
  async retry(taskId: string): Promise<TaskRecord | null> {
    return this.store.retryTask(taskId);
  }

  /** Recover orphaned tasks for a runtime (called on restart). */
  async recoverOrphans(runtimeId: string): Promise<{ recovered: TaskRecord[]; retried: TaskRecord[] }> {
    const recovered = await this.store.recoverOrphanedTasks(runtimeId);
    const retried: TaskRecord[] = [];

    for (const task of recovered) {
      this.emit('task:failed', task);
      if (this.shouldRetry(task)) {
        const retriedTask = await this.retry(task.id);
        if (retriedTask) {
          retried.push(retriedTask);
          this.emit('task:retrying', retriedTask);
        }
      }
    }

    return { recovered, retried };
  }

  /** Pin session info on a task for crash recovery. */
  async pinSession(taskId: string, sessionId: string, workDir?: string): Promise<TaskRecord | null> {
    return this.store.pinTaskSession(taskId, sessionId, workDir);
  }

  /** Get a task by ID. */
  async get(taskId: string): Promise<TaskRecord | null> {
    return this.store.getTask(taskId);
  }

  /** List tasks with filters. */
  async list(filters: TaskListFilters): Promise<{ tasks: TaskRecord[]; total: number }> {
    return this.store.listTasks(filters);
  }

  /** Count tasks by status for an agent. */
  async countByStatus(agentId: string): Promise<Record<string, number>> {
    return this.store.countByStatus(agentId);
  }

  /** Handle multiple failed tasks (e.g. from orphan recovery). */
  async handleFailedTasks(tasks: TaskRecord[]): Promise<number> {
    let retriedCount = 0;
    for (const task of tasks) {
      if (this.shouldRetry(task)) {
        const retried = await this.retry(task.id);
        if (retried) {
          retriedCount++;
          this.emit('task:retrying', retried);
        }
      }
    }
    return retriedCount;
  }

  /** Check if a failed task should be retried. */
  private shouldRetry(task: TaskRecord): boolean {
    if (!task.failureReason) return false;
    if (!RETRYABLE_REASONS.has(task.failureReason)) return false;
    if (task.attempt >= task.maxAttempts) return false;
    // Don't retry autopilot tasks — the autopilot scheduler handles re-runs
    if (task.autopilotRunId) return false;
    // Only retry tasks linked to issues or chat sessions
    return !!(task.issueId);
  }

  /** Get the underlying store (for testing). */
  getStore(): PostgresTaskStore {
    return this.store;
  }
}

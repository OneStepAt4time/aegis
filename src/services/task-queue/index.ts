/**
 * services/task-queue/index.ts — Public API for the task queue module.
 */

export { TaskService } from './service.js';
export type { TaskServiceConfig, TaskEventCallback } from './service.js';
export { PostgresTaskStore } from './store.js';
export type { TaskStoreConfig } from './store.js';
export type {
  TaskRecord,
  TaskStatus,
  TaskPriority,
  TaskFailureReason,
  CreateTaskParams,
  CompleteTaskParams,
  FailTaskParams,
  TaskListFilters,
  TaskEventType,
  TaskEvent,
} from './types.js';
export {
  RETRYABLE_REASONS,
  priorityToNumber,
  parseFailureReason,
  isTerminalStatus,
} from './types.js';

/**
 * services/task-queue/types.ts — Task queue domain types.
 *
 * Ported from Multica's task lifecycle model. A task represents a unit of
 * work assigned to an Aegis session: it goes through a state machine
 * (queued → dispatched → running → completed/failed) with automatic
 * retry for transient failures.
 *
 * Adapted to Aegis patterns: TypeScript, Fastify, pg-based store.
 */

/** Task status enum — matches the task state machine. */
export type TaskStatus =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Task priority levels. */
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Failure reason classifiers — determines retry eligibility. */
export type TaskFailureReason =
  | 'agent_error'       // Generic agent failure
  | 'runtime_offline'   // Runtime was offline when dispatched
  | 'runtime_recovery'  // Runtime recovered from crash
  | 'timeout'           // Task exceeded time limit
  | 'cancelled'         // User cancelled
  | 'iteration_limit'   // Agent hit iteration limit
  | 'unknown';          // Unclassified

/** Reason → retryable mapping. */
export const RETRYABLE_REASONS: ReadonlySet<TaskFailureReason> = new Set([
  'runtime_offline',
  'runtime_recovery',
  'timeout',
  'agent_error',
]);

/** Core task record stored in the database. */
export interface TaskRecord {
  /** UUID primary key. */
  id: string;
  /** Agent/session that will execute this task. */
  agentId: string;
  /** Runtime ID that claimed the task. */
  runtimeId: string | null;
  /** Issue ID if this task is linked to an issue. */
  issueId: string | null;
  /** Autopilot run ID if triggered by autopilot. */
  autopilotRunId: string | null;
  /** Current status in the state machine. */
  status: TaskStatus;
  /** Task priority for queue ordering. */
  priority: TaskPriority;
  /** Current attempt number (1-based). */
  attempt: number;
  /** Maximum retry attempts. */
  maxAttempts: number;
  /** Session ID from the running agent (for resume). */
  sessionId: string | null;
  /** Working directory from the running agent. */
  workDir: string | null;
  /** Task prompt / instructions. */
  prompt: string | null;
  /** JSONB context data (e.g. quick-create payload). */
  context: Record<string, unknown> | null;
  /** Result payload on completion. */
  result: Record<string, unknown> | null;
  /** Error message on failure. */
  error: string | null;
  /** Classified failure reason. */
  failureReason: TaskFailureReason | null;
  /** Trigger comment summary (for display). */
  triggerSummary: string | null;
  /** Whether this task should force a fresh session (no resume). */
  forceFreshSession: boolean;
  /** Whether this is a squad leader task. */
  isLeaderTask: boolean;
  /** Tenant ID for multi-tenancy. */
  tenantId: string | null;
  /** Owner key ID for access control. */
  ownerKeyId: string | null;
  /** When the task was created. */
  createdAt: Date;
  /** When the task was dispatched. */
  dispatchedAt: Date | null;
  /** When the task started running. */
  startedAt: Date | null;
  /** When the task completed/failed. */
  completedAt: Date | null;
  /** When the record was last updated. */
  updatedAt: Date;
}

/** Parameters for creating a new task. */
export interface CreateTaskParams {
  agentId: string;
  runtimeId?: string;
  issueId?: string;
  autopilotRunId?: string;
  priority?: TaskPriority;
  prompt?: string;
  context?: Record<string, unknown>;
  triggerSummary?: string;
  forceFreshSession?: boolean;
  isLeaderTask?: boolean;
  maxAttempts?: number;
  tenantId?: string;
  ownerKeyId?: string;
}

/** Parameters for completing a task. */
export interface CompleteTaskParams {
  taskId: string;
  result?: Record<string, unknown>;
  sessionId?: string;
  workDir?: string;
}

/** Parameters for failing a task. */
export interface FailTaskParams {
  taskId: string;
  error: string;
  failureReason?: TaskFailureReason;
  sessionId?: string;
  workDir?: string;
}

/** Parameters for claiming a task. */
export interface ClaimTaskParams {
  agentId: string;
  runtimeId?: string;
}

/** Task list query filters. */
export interface TaskListFilters {
  status?: TaskStatus;
  agentId?: string;
  issueId?: string;
  autopilotRunId?: string;
  tenantId?: string;
  ownerKeyId?: string;
  limit?: number;
  offset?: number;
}

/** Task queue event types emitted on the event bus. */
export type TaskEventType =
  | 'task:queued'
  | 'task:dispatched'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:cancelled'
  | 'task:retrying';

/** Event payload for task events. */
export interface TaskEvent {
  type: TaskEventType;
  task: TaskRecord;
  timestamp: Date;
}

/** Priority to numeric sort order (higher = more urgent). */
export function priorityToNumber(p: TaskPriority): number {
  switch (p) {
    case 'urgent': return 4;
    case 'high': return 3;
    case 'normal': return 2;
    case 'low': return 1;
    default: return 2;
  }
}

/** Parse a failure reason from a string. */
export function parseFailureReason(reason: string): TaskFailureReason {
  if ((RETRYABLE_REASONS as ReadonlySet<string>).has(reason)) return reason as TaskFailureReason;
  const valid: TaskFailureReason[] = ['agent_error', 'runtime_offline', 'runtime_recovery', 'timeout', 'cancelled', 'iteration_limit', 'unknown'];
  return valid.includes(reason as TaskFailureReason) ? (reason as TaskFailureReason) : 'unknown';
}

/** Check if a task is in a terminal state. */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

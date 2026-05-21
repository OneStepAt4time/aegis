/**
 * services/task-queue/store.ts — PostgreSQL-backed task queue store.
 *
 * Ported from Multica's pgx/sqlc-based task persistence. Uses the same
 * Aegis pattern as PostgresStore.ts: pg Pool, CREATE TABLE IF NOT EXISTS,
 * JSONB for flexible fields.
 *
 * State machine: queued → dispatched → running → completed/failed/cancelled
 * Retry: failed → queued (new attempt) for retryable reasons.
 */

import { Pool, type PoolClient } from 'pg';
import type {
  TaskRecord,
  TaskStatus,
  CreateTaskParams,
  CompleteTaskParams,
  FailTaskParams,
  TaskListFilters,
  TaskPriority,
} from './types.js';
import { priorityToNumber, parseFailureReason } from './types.js';

/** PostgreSQL store configuration. */
export interface TaskStoreConfig {
  url: string;
  tableName?: string;
  schemaName?: string;
  poolMax?: number;
}

const DEFAULT_TABLE = 'aegis_tasks';
const DEFAULT_SCHEMA = 'public';
const DEFAULT_POOL_MAX = 5;

/** Row shape from the database. */
interface TaskRow {
  id: string;
  agent_id: string;
  runtime_id: string | null;
  issue_id: string | null;
  autopilot_run_id: string | null;
  status: string;
  priority: string;
  priority_order: number;
  attempt: number;
  max_attempts: number;
  session_id: string | null;
  work_dir: string | null;
  prompt: string | null;
  context: unknown;
  result: unknown;
  error: string | null;
  failure_reason: string | null;
  trigger_summary: string | null;
  force_fresh_session: boolean;
  is_leader_task: boolean;
  tenant_id: string | null;
  owner_key_id: string | null;
  created_at: Date;
  dispatched_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}

function rowToRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    runtimeId: row.runtime_id,
    issueId: row.issue_id,
    autopilotRunId: row.autopilot_run_id,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    sessionId: row.session_id,
    workDir: row.work_dir,
    prompt: row.prompt,
    context: row.context as Record<string, unknown> | null,
    result: row.result as Record<string, unknown> | null,
    error: row.error,
    failureReason: row.failure_reason ? parseFailureReason(row.failure_reason) : null,
    triggerSummary: row.trigger_summary,
    forceFreshSession: row.force_fresh_session,
    isLeaderTask: row.is_leader_task,
    tenantId: row.tenant_id,
    ownerKeyId: row.owner_key_id,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresTaskStore {
  private pool!: Pool;
  private readonly url: string;
  private readonly tableName: string;
  private readonly schemaName: string;
  private readonly poolMax: number;

  constructor(config: TaskStoreConfig) {
    this.url = config.url;
    this.tableName = config.tableName ?? DEFAULT_TABLE;
    this.schemaName = config.schemaName ?? DEFAULT_SCHEMA;
    this.poolMax = config.poolMax ?? DEFAULT_POOL_MAX;
  }

  /** Qualified table name with schema. */
  private qt(): string {
    return `"${this.schemaName}"."${this.tableName}"`;
  }

  /** Initialize pool and create tables. */
  async start(): Promise<void> {
    this.pool = new Pool({ connectionString: this.url, max: this.poolMax });
    await this.ensureSchema();
  }

  /** Close pool. */
  async stop(): Promise<void> {
    await this.pool.end();
  }

  /** Health check. */
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT 1');
      return result.rowCount === 1;
    } catch {
      return false;
    }
  }

  /** Create the tasks table if it does not exist. */
  private async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.qt()} (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id            TEXT NOT NULL,
        runtime_id          TEXT,
        issue_id            TEXT,
        autopilot_run_id    TEXT,
        status              TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued','dispatched','running','completed','failed','cancelled')),
        priority            TEXT NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low','normal','high','urgent')),
        priority_order      INT NOT NULL DEFAULT 2,
        attempt             INT NOT NULL DEFAULT 1,
        max_attempts        INT NOT NULL DEFAULT 3,
        session_id          TEXT,
        work_dir            TEXT,
        prompt              TEXT,
        context             JSONB DEFAULT NULL,
        result              JSONB DEFAULT NULL,
        error               TEXT,
        failure_reason      TEXT,
        trigger_summary     TEXT,
        force_fresh_session BOOLEAN NOT NULL DEFAULT FALSE,
        is_leader_task      BOOLEAN NOT NULL DEFAULT FALSE,
        tenant_id           TEXT,
        owner_key_id        TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        dispatched_at       TIMESTAMPTZ,
        started_at          TIMESTAMPTZ,
        completed_at        TIMESTAMPTZ,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Indexes for the most common query patterns
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_agent_status"
      ON ${this.qt()} (agent_id, status, priority_order DESC, created_at)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_status_priority"
      ON ${this.qt()} (status, priority_order DESC, created_at)
      WHERE status = 'queued'
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_issue"
      ON ${this.qt()} (issue_id)
      WHERE issue_id IS NOT NULL
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_autopilot"
      ON ${this.qt()} (autopilot_run_id)
      WHERE autopilot_run_id IS NOT NULL
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_tenant"
      ON ${this.qt()} (tenant_id)
      WHERE tenant_id IS NOT NULL
    `);
  }

  /** Create a new task. */
  async createTask(params: CreateTaskParams): Promise<TaskRecord> {
    const priority = params.priority ?? 'normal';
    const result = await this.pool.query<TaskRow>(
      `INSERT INTO ${this.qt()} (
        agent_id, runtime_id, issue_id, autopilot_run_id,
        status, priority, priority_order,
        attempt, max_attempts,
        prompt, context, trigger_summary,
        force_fresh_session, is_leader_task,
        tenant_id, owner_key_id
      ) VALUES ($1,$2,$3,$4,'queued',$5,$6,1,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        params.agentId,
        params.runtimeId ?? null,
        params.issueId ?? null,
        params.autopilotRunId ?? null,
        priority,
        priorityToNumber(priority),
        params.maxAttempts ?? 3,
        params.prompt ?? null,
        params.context ? JSON.stringify(params.context) : null,
        params.triggerSummary ?? null,
        params.forceFreshSession ?? false,
        params.isLeaderTask ?? false,
        params.tenantId ?? null,
        params.ownerKeyId ?? null,
      ],
    );
    return rowToRecord(result.rows[0]);
  }

  /** Get a task by ID. */
  async getTask(taskId: string): Promise<TaskRecord | null> {
    const result = await this.pool.query<TaskRow>(
      `SELECT * FROM ${this.qt()} WHERE id = $1`,
      [taskId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  /** Claim the next queued task for an agent. */
  async claimTask(agentId: string, runtimeId?: string): Promise<TaskRecord | null> {
    // Use a transaction to atomically claim
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Count running tasks for capacity check
      const countResult = await client.query(
        `SELECT COUNT(*) as cnt FROM ${this.qt()}
         WHERE agent_id = $1 AND status IN ('dispatched', 'running')`,
        [agentId],
      );
      // Default max concurrent = 1 for now; can be made configurable
      const running = parseInt(countResult.rows[0].cnt, 10);
      if (running >= 1) {
        await client.query('COMMIT');
        return null; // No capacity
      }

      // Atomically claim the highest-priority, oldest queued task
      const claimResult = await client.query<TaskRow>(
        `UPDATE ${this.qt()}
         SET status = 'dispatched',
             runtime_id = COALESCE($2, runtime_id),
             dispatched_at = NOW(),
             updated_at = NOW()
         WHERE id = (
           SELECT id FROM ${this.qt()}
           WHERE agent_id = $1 AND status = 'queued'
           ORDER BY priority_order DESC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING *`,
        [agentId, runtimeId ?? null],
      );

      await client.query('COMMIT');
      return claimResult.rows[0] ? rowToRecord(claimResult.rows[0]) : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Start a dispatched task (transition to running). */
  async startTask(taskId: string): Promise<TaskRecord | null> {
    const result = await this.pool.query<TaskRow>(
      `UPDATE ${this.qt()}
       SET status = 'running',
           started_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'dispatched'
       RETURNING *`,
      [taskId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  /** Complete a running task. */
  async completeTask(params: CompleteTaskParams): Promise<TaskRecord | null> {
    const result = await this.pool.query<TaskRow>(
      `UPDATE ${this.qt()}
       SET status = 'completed',
           result = $2,
           session_id = COALESCE($3, session_id),
           work_dir = COALESCE($4, work_dir),
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'running'
       RETURNING *`,
      [
        params.taskId,
        params.result ? JSON.stringify(params.result) : null,
        params.sessionId ?? null,
        params.workDir ?? null,
      ],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  /** Fail a running task. */
  async failTask(params: FailTaskParams): Promise<TaskRecord | null> {
    const result = await this.pool.query<TaskRow>(
      `UPDATE ${this.qt()}
       SET status = 'failed',
           error = $2,
           failure_reason = $3,
           session_id = COALESCE($4, session_id),
           work_dir = COALESCE($5, work_dir),
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status IN ('running', 'dispatched')
       RETURNING *`,
      [
        params.taskId,
        params.error,
        params.failureReason ?? 'agent_error',
        params.sessionId ?? null,
        params.workDir ?? null,
      ],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  /** Cancel a task (any non-terminal state). */
  async cancelTask(taskId: string): Promise<TaskRecord | null> {
    const result = await this.pool.query<TaskRow>(
      `UPDATE ${this.qt()}
       SET status = 'cancelled',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')
       RETURNING *`,
      [taskId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  /** Cancel all tasks for an issue. */
  async cancelTasksForIssue(issueId: string): Promise<TaskRecord[]> {
    const result = await this.pool.query<TaskRow>(
      `UPDATE ${this.qt()}
       SET status = 'cancelled',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE issue_id = $1 AND status NOT IN ('completed', 'failed', 'cancelled')
       RETURNING *`,
      [issueId],
    );
    return result.rows.map(rowToRecord);
  }

  /** Retry a failed task — creates a new task row with attempt incremented. */
  async retryTask(taskId: string): Promise<TaskRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<TaskRow>(
        `SELECT * FROM ${this.qt()} WHERE id = $1 AND status = 'failed'`,
        [taskId],
      );
      if (existing.rows.length === 0) {
        await client.query('COMMIT');
        return null;
      }

      const orig = existing.rows[0];
      if (orig.attempt >= orig.max_attempts) {
        await client.query('COMMIT');
        return null; // Max retries reached
      }

      const newAttempt = orig.attempt + 1;
      const result = await client.query<TaskRow>(
        `INSERT INTO ${this.qt()} (
          agent_id, runtime_id, issue_id, autopilot_run_id,
          status, priority, priority_order,
          attempt, max_attempts,
          session_id, work_dir,
          prompt, context, trigger_summary,
          force_fresh_session, is_leader_task,
          tenant_id, owner_key_id
        ) VALUES ($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *`,
        [
          orig.agent_id,
          orig.runtime_id,
          orig.issue_id,
          orig.autopilot_run_id,
          orig.priority,
          orig.priority_order,
          newAttempt,
          orig.max_attempts,
          null, // Fresh session_id for retry
          null, // Fresh work_dir for retry
          orig.prompt,
          orig.context ? JSON.stringify(orig.context) : null,
          orig.trigger_summary,
          false, // Retries inherit the session (unless force_fresh)
          orig.is_leader_task,
          orig.tenant_id,
          orig.owner_key_id,
        ],
      );

      await client.query('COMMIT');
      return result.rows[0] ? rowToRecord(result.rows[0]) : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Recover orphaned tasks (tasks stuck in dispatched/running on restart). */
  async recoverOrphanedTasks(runtimeId: string): Promise<TaskRecord[]> {
    const result = await this.pool.query<TaskRow>(
      `UPDATE ${this.qt()}
       SET status = 'failed',
           error = 'orphaned: runtime restarted',
           failure_reason = 'runtime_recovery',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE runtime_id = $1
         AND status IN ('dispatched', 'running')
       RETURNING *`,
      [runtimeId],
    );
    return result.rows.map(rowToRecord);
  }

  /** Pin session info on a task (for crash recovery). */
  async pinTaskSession(taskId: string, sessionId: string, workDir?: string): Promise<TaskRecord | null> {
    const result = await this.pool.query<TaskRow>(
      `UPDATE ${this.qt()}
       SET session_id = $2,
           work_dir = COALESCE($3, work_dir),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [taskId, sessionId, workDir ?? null],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  /** List tasks with filters. */
  async listTasks(filters: TaskListFilters): Promise<{ tasks: TaskRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (filters.status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(filters.status);
    }
    if (filters.agentId) {
      conditions.push(`agent_id = $${paramIdx++}`);
      values.push(filters.agentId);
    }
    if (filters.issueId) {
      conditions.push(`issue_id = $${paramIdx++}`);
      values.push(filters.issueId);
    }
    if (filters.autopilotRunId) {
      conditions.push(`autopilot_run_id = $${paramIdx++}`);
      values.push(filters.autopilotRunId);
    }
    if (filters.tenantId) {
      conditions.push(`tenant_id = $${paramIdx++}`);
      values.push(filters.tenantId);
    }
    if (filters.ownerKeyId) {
      conditions.push(`owner_key_id = $${paramIdx++}`);
      values.push(filters.ownerKeyId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as cnt FROM ${this.qt()} ${where}`,
      values,
    );
    const total = parseInt(countResult.rows[0].cnt, 10);

    const result = await this.pool.query<TaskRow>(
      `SELECT * FROM ${this.qt()} ${where}
       ORDER BY priority_order DESC, created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    );

    return {
      tasks: result.rows.map(rowToRecord),
      total,
    };
  }

  /** Count tasks by status for an agent. */
  async countByStatus(agentId: string): Promise<Record<TaskStatus, number>> {
    const result = await this.pool.query(
      `SELECT status, COUNT(*) as cnt FROM ${this.qt()}
       WHERE agent_id = $1
       GROUP BY status`,
      [agentId],
    );
    const counts: Record<string, number> = {
      queued: 0, dispatched: 0, running: 0,
      completed: 0, failed: 0, cancelled: 0,
    };
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.cnt, 10);
    }
    return counts as Record<TaskStatus, number>;
  }

  /** Run a function in a transaction. */
  async runInTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

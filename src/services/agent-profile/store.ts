/**
 * services/agent-profile/store.ts — Postgres-backed agent profile store.
 *
 * Uses the same CREATE TABLE IF NOT EXISTS auto-provisioning pattern
 * as PostgresStore.ts for session state.
 */

import pg from 'pg';
import type {
  AgentProfileRecord,
  CreateAgentProfileParams,
  UpdateAgentProfileParams,
  AgentListFilters,
  AgentVisibility,
  ThinkingLevel,
  AgentStatus,
} from './types.js';

const COLUMNS = [
  'id', 'workspace_id', 'name', 'description', 'avatar_url',
  'runtime_mode', 'runtime_config', 'runtime_id',
  'model', 'thinking_level', 'max_concurrent_tasks',
  'instructions', 'custom_env', 'custom_args', 'mcp_config',
  'visibility', 'owner_id', 'status',
  'archived_at', 'archived_by',
  'created_at', 'updated_at',
  'tenant_id', 'owner_key_id',
] as const;

function toRecord(row: Record<string, unknown>): AgentProfileRecord {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    name: row.name as string,
    description: row.description as string | null,
    avatarUrl: row.avatar_url as string | null,
    runtimeMode: (row.runtime_mode as RuntimeMode) ?? 'daemon',
    runtimeConfig: (row.runtime_config as Record<string, unknown>) ?? {},
    runtimeId: row.runtime_id as string | null,
    model: row.model as string | null,
    thinkingLevel: row.thinking_level as ThinkingLevel | null,
    maxConcurrentTasks: (row.max_concurrent_tasks as number) ?? 1,
    instructions: row.instructions as string | null,
    customEnv: (row.custom_env as Array<{ key: string; value: string }>) ?? [],
    customArgs: (row.custom_args as string[]) ?? [],
    mcpConfig: (row.mcp_config as Record<string, unknown>) ?? {},
    visibility: (row.visibility as AgentVisibility) ?? 'workspace',
    ownerId: row.owner_id as string | null,
    status: (row.status as AgentStatus) ?? 'unknown',
    archivedAt: row.archived_at as Date | null,
    archivedBy: row.archived_by as string | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    tenantId: row.tenant_id as string | null,
    ownerKeyId: row.owner_key_id as string | null,
  };
}

export interface AgentProfileStoreOptions {
  url: string;
  tableName?: string;
  poolMax?: number;
}

export class PostgresAgentProfileStore {
  readonly pool: pg.Pool;
  private readonly tableName: string;
  private ready = false;

  constructor(opts: AgentProfileStoreOptions) {
    this.tableName = opts.tableName ?? 'agent_profile';
    this.pool = new pg.Pool({
      connectionString: opts.url,
      max: opts.poolMax ?? 4,
    });
  }

  async start(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        workspace_id    TEXT NOT NULL DEFAULT '',
        name            TEXT NOT NULL,
        description     TEXT,
        avatar_url      TEXT,

        runtime_mode    TEXT NOT NULL DEFAULT 'daemon',
        runtime_config  JSONB NOT NULL DEFAULT '{}',
        runtime_id      TEXT,

        model           TEXT,
        thinking_level  TEXT,
        max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,

        instructions    TEXT,
        custom_env      JSONB NOT NULL DEFAULT '[]',
        custom_args     JSONB NOT NULL DEFAULT '[]',
        mcp_config      JSONB NOT NULL DEFAULT '{}',

        visibility      TEXT NOT NULL DEFAULT 'workspace',
        owner_id        TEXT,

        status          TEXT NOT NULL DEFAULT 'unknown',
        archived_at     TIMESTAMPTZ,
        archived_by     TEXT,

        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

        tenant_id       TEXT,
        owner_key_id    TEXT
      );
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_workspace"
      ON "${this.tableName}"(workspace_id) WHERE archived_at IS NULL;
    `);
    this.ready = true;
  }

  async stop(): Promise<void> {
    await this.pool.end();
  }

  async create(params: CreateAgentProfileParams): Promise<AgentProfileRecord> {
    const id = crypto.randomUUID();
    const row = {
      id,
      workspace_id: params.workspaceId ?? '',
      name: params.name,
      description: params.description ?? null,
      avatar_url: params.avatarUrl ?? null,
      runtime_mode: params.runtimeMode ?? 'daemon',
      runtime_config: JSON.stringify(params.runtimeConfig ?? {}),
      runtime_id: params.runtimeId ?? null,
      model: params.model ?? null,
      thinking_level: params.thinkingLevel ?? null,
      max_concurrent_tasks: params.maxConcurrentTasks ?? 1,
      instructions: params.instructions ?? null,
      custom_env: JSON.stringify(params.customEnv ?? []),
      custom_args: JSON.stringify(params.customArgs ?? []),
      mcp_config: JSON.stringify(params.mcpConfig ?? {}),
      visibility: params.visibility ?? 'workspace',
      owner_id: params.ownerId ?? null,
      status: 'unknown',
      tenant_id: params.tenantId ?? null,
      owner_key_id: params.ownerKeyId ?? null,
    };

    const keys = Object.keys(row);
    const values = Object.values(row);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const colNames = keys.join(', ');

    const result = await this.pool.query(
      `INSERT INTO "${this.tableName}" (${colNames}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    return toRecord(result.rows[0]);
  }

  async get(id: string): Promise<AgentProfileRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM "${this.tableName}" WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async list(filters: AgentListFilters): Promise<{ agents: AgentProfileRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (!filters.includeArchived) {
      conditions.push('archived_at IS NULL');
    }
    if (filters.workspaceId) {
      conditions.push(`workspace_id = $${paramIdx++}`);
      values.push(filters.workspaceId);
    }
    if (filters.visibility) {
      conditions.push(`visibility = $${paramIdx++}`);
      values.push(filters.visibility);
    }
    if (filters.status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(filters.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as cnt FROM "${this.tableName}" ${where}`,
      values,
    );
    const total = Number(countResult.rows[0].cnt);

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const result = await this.pool.query(
      `SELECT * FROM "${this.tableName}" ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, limit, offset],
    );

    return {
      agents: result.rows.map(toRecord),
      total,
    };
  }

  async update(id: string, params: UpdateAgentProfileParams): Promise<AgentProfileRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, [string, unknown]> = {};
    if (params.name !== undefined) fieldMap['name'] = ['name', params.name];
    if (params.description !== undefined) fieldMap['description'] = ['description', params.description];
    if (params.avatarUrl !== undefined) fieldMap['avatar_url'] = ['avatar_url', params.avatarUrl];
    if (params.runtimeMode !== undefined) fieldMap['runtime_mode'] = ['runtime_mode', params.runtimeMode];
    if (params.runtimeConfig !== undefined) fieldMap['runtime_config'] = ['runtime_config', JSON.stringify(params.runtimeConfig)];
    if (params.runtimeId !== undefined) fieldMap['runtime_id'] = ['runtime_id', params.runtimeId];
    if (params.model !== undefined) fieldMap['model'] = ['model', params.model];
    if (params.thinkingLevel !== undefined) fieldMap['thinking_level'] = ['thinking_level', params.thinkingLevel];
    if (params.maxConcurrentTasks !== undefined) fieldMap['max_concurrent_tasks'] = ['max_concurrent_tasks', params.maxConcurrentTasks];
    if (params.instructions !== undefined) fieldMap['instructions'] = ['instructions', params.instructions];
    if (params.customEnv !== undefined) fieldMap['custom_env'] = ['custom_env', JSON.stringify(params.customEnv)];
    if (params.customArgs !== undefined) fieldMap['custom_args'] = ['custom_args', JSON.stringify(params.customArgs)];
    if (params.mcpConfig !== undefined) fieldMap['mcp_config'] = ['mcp_config', JSON.stringify(params.mcpConfig)];
    if (params.visibility !== undefined) fieldMap['visibility'] = ['visibility', params.visibility];

    for (const [col, val] of Object.values(fieldMap)) {
      sets.push(`"${col}" = $${paramIdx++}`);
      values.push(val);
    }

    if (sets.length === 0) return this.get(id);

    sets.push(`"updated_at" = now()`);
    values.push(id);

    const result = await this.pool.query(
      `UPDATE "${this.tableName}" SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values,
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async archive(id: string, archivedBy?: string): Promise<AgentProfileRecord | null> {
    const result = await this.pool.query(
      `UPDATE "${this.tableName}" SET archived_at = now(), archived_by = $2, updated_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING *`,
      [id, archivedBy ?? null],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async restore(id: string): Promise<AgentProfileRecord | null> {
    const result = await this.pool.query(
      `UPDATE "${this.tableName}" SET archived_at = NULL, archived_by = NULL, updated_at = now() WHERE id = $1 AND archived_at IS NOT NULL RETURNING *`,
      [id],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async updateStatus(id: string, status: AgentStatus): Promise<AgentProfileRecord | null> {
    const result = await this.pool.query(
      `UPDATE "${this.tableName}" SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async countActiveByRuntime(runtimeId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as cnt FROM "${this.tableName}" WHERE runtime_id = $1 AND archived_at IS NULL`,
      [runtimeId],
    );
    return Number(result.rows[0].cnt);
  }
}

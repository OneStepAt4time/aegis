import { Pool } from 'pg';

import type { ServiceHealth } from '../../container.js';
import type {
  AcpBackendMetadata,
  AcpBackendMetadataValue,
  AcpSessionRecord,
  AcpSessionScope,
  AcpSessionStatus,
  AcpSessionStore,
} from './types.js';

export interface PostgresAcpSessionStoreConfig {
  url: string;
  schemaName?: string;
  tableName?: string;
  poolMax?: number;
}

const DEFAULT_SCHEMA = 'public';
const DEFAULT_TABLE = 'acp_sessions';
const DEFAULT_POOL_MAX = 5;
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

interface AcpSessionRow {
  session_id: string;
  tenant_id: string;
  owner_key_id: string;
  acp_agent_session_id: string | null;
  claude_session_id: string | null;
  conversation_id: string;
  transcript_id: string;
  parent_session_id: string | null;
  root_session_id: string | null;
  correlation_id: string | null;
  resume_from_session_id: string | null;
  current_backend_run_id: string | null;
  status: string;
  created_at: string | number;
  updated_at: string | number;
  closed_at: string | number | null;
  failed_at: string | number | null;
  backend_metadata: unknown | null;
}

const SESSION_COLUMNS = `
  session_id,
  tenant_id,
  owner_key_id,
  acp_agent_session_id,
  claude_session_id,
  conversation_id,
  transcript_id,
  parent_session_id,
  root_session_id,
  correlation_id,
  resume_from_session_id,
  current_backend_run_id,
  status,
  created_at,
  updated_at,
  closed_at,
  failed_at,
  backend_metadata
`;

export class PostgresAcpSessionStore implements AcpSessionStore {
  private pool: Pool | undefined;
  private readonly url: string;
  private readonly schemaName: string;
  private readonly tableName: string;
  private readonly poolMax: number;

  constructor(config: PostgresAcpSessionStoreConfig) {
    this.url = config.url;
    this.schemaName = config.schemaName ?? DEFAULT_SCHEMA;
    this.tableName = config.tableName ?? DEFAULT_TABLE;
    this.poolMax = config.poolMax ?? DEFAULT_POOL_MAX;

    validateIdentifier(this.schemaName, 'schema name');
    validateIdentifier(this.tableName, 'table name');
  }

  async start(): Promise<void> {
    if (this.pool !== undefined) return;
    this.pool = new Pool({
      connectionString: this.url,
      max: this.poolMax,
    });
    await this.ensureSchema();
    await this.pool.query('SELECT 1 AS ok');
  }

  async stop(_signal?: AbortSignal): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    if (pool !== undefined) {
      await pool.end();
    }
  }

  async health(): Promise<ServiceHealth> {
    const pool = this.pool;
    if (pool === undefined) {
      return { healthy: false, details: 'postgres acp session store not started' };
    }

    try {
      await pool.query('SELECT 1 AS ok');
      return { healthy: true, details: 'postgres acp session store ok' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, details: `postgres acp session store: ${message}` };
    }
  }

  async create(record: AcpSessionRecord): Promise<void> {
    await this.requirePool().query(
      `INSERT INTO ${this.qualifiedTable()} (${SESSION_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      recordToInsertParams(record)
    );
  }

  async get(id: string, scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    const result = await this.requirePool().query<AcpSessionRow>(
      `SELECT ${SESSION_COLUMNS}
       FROM ${this.qualifiedTable()}
       WHERE session_id = $1 AND tenant_id = $2 AND owner_key_id = $3
       LIMIT 1`,
      [id, scope.tenantId, scope.ownerKeyId]
    );
    const row = result.rows[0];
    return row === undefined ? null : rowToRecord(row);
  }

  async update(record: AcpSessionRecord, scope: AcpSessionScope): Promise<AcpSessionRecord | null> {
    assertRecordMatchesScope(record, scope);
    const result = await this.requirePool().query<AcpSessionRow>(
      `UPDATE ${this.qualifiedTable()}
       SET acp_agent_session_id = $4,
            claude_session_id = $5,
            current_backend_run_id = $6,
            status = $7,
            updated_at = $8,
            closed_at = $9,
            failed_at = $10,
            backend_metadata = $11
        WHERE session_id = $1 AND tenant_id = $2 AND owner_key_id = $3
          AND tenant_id = $12 AND owner_key_id = $13
        RETURNING ${SESSION_COLUMNS}`,
      recordToUpdateParams(record, scope)
    );
    const row = result.rows[0];
    return row === undefined ? null : rowToRecord(row);
  }

  private requirePool(): Pool {
    if (this.pool === undefined) {
      throw new Error('PostgresAcpSessionStore: store has not been started');
    }
    return this.pool;
  }

  private qualifiedTable(): string {
    return `${quoteIdentifier(this.schemaName)}.${quoteIdentifier(this.tableName)}`;
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.requirePool();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(this.schemaName)}`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.qualifiedTable()} (
        session_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        owner_key_id TEXT NOT NULL,
        acp_agent_session_id TEXT,
        claude_session_id TEXT,
        conversation_id TEXT NOT NULL,
        transcript_id TEXT NOT NULL,
        parent_session_id TEXT,
        root_session_id TEXT,
        correlation_id TEXT,
        resume_from_session_id TEXT,
        current_backend_run_id TEXT,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        closed_at BIGINT,
        failed_at BIGINT,
        backend_metadata JSONB,
        CONSTRAINT ${quoteIdentifier(`${this.tableName}_pkey`)} PRIMARY KEY (tenant_id, owner_key_id, session_id),
        CONSTRAINT ${quoteIdentifier(`${this.tableName}_status_check`)} CHECK (status IN ('initializing', 'idle', 'running', 'paused', 'intervening', 'closing', 'closed', 'failed')),
        CONSTRAINT ${quoteIdentifier(`${this.tableName}_backend_metadata_object_check`)} CHECK (backend_metadata IS NULL OR jsonb_typeof(backend_metadata) = 'object')
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${this.tableName}_scope_session`)}
      ON ${this.qualifiedTable()} (tenant_id, owner_key_id, session_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${this.tableName}_updated_at`)}
      ON ${this.qualifiedTable()} (updated_at)
    `);
  }
}

function assertRecordMatchesScope(record: AcpSessionRecord, scope: AcpSessionScope): void {
  if (record.tenantId !== scope.tenantId || record.ownerKeyId !== scope.ownerKeyId) {
    throw new Error('PostgresAcpSessionStore: record scope does not match requested scope');
  }
}

function validateIdentifier(identifier: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `PostgresAcpSessionStore: invalid ${label} "${identifier}" — must match [a-zA-Z_][a-zA-Z0-9_]*`
    );
  }
}

function quoteIdentifier(identifier: string): string {
  validateIdentifier(identifier, 'identifier');
  return `"${identifier}"`;
}

function recordToInsertParams(record: AcpSessionRecord): unknown[] {
  return [
    record.id,
    record.tenantId,
    record.ownerKeyId,
    record.acpAgentSessionId ?? null,
    record.claudeSessionId ?? null,
    record.conversationId,
    record.transcriptId,
    record.parentSessionId ?? null,
    record.rootSessionId ?? null,
    record.correlationId ?? null,
    record.resumeFromSessionId ?? null,
    record.currentBackendRunId ?? null,
    record.status,
    record.createdAt,
    record.updatedAt,
    record.closedAt ?? null,
    record.failedAt ?? null,
    serializeBackendMetadata(record.backendMetadata),
  ];
}

function recordToUpdateParams(record: AcpSessionRecord, scope: AcpSessionScope): unknown[] {
  return [
    record.id,
    scope.tenantId,
    scope.ownerKeyId,
    record.acpAgentSessionId ?? null,
    record.claudeSessionId ?? null,
    record.currentBackendRunId ?? null,
    record.status,
    record.updatedAt,
    record.closedAt ?? null,
    record.failedAt ?? null,
    serializeBackendMetadata(record.backendMetadata),
    record.tenantId,
    record.ownerKeyId,
  ];
}

function serializeBackendMetadata(metadata: AcpBackendMetadata | undefined): string | null {
  return metadata === undefined ? null : JSON.stringify(metadata);
}

function rowToRecord(row: AcpSessionRow): AcpSessionRecord {
  const record: AcpSessionRecord = {
    id: row.session_id,
    tenantId: row.tenant_id,
    ownerKeyId: row.owner_key_id,
    conversationId: row.conversation_id,
    transcriptId: row.transcript_id,
    status: parseStatus(row.status),
    createdAt: parseRequiredTimestamp(row.created_at, 'created_at'),
    updatedAt: parseRequiredTimestamp(row.updated_at, 'updated_at'),
  };

  if (row.acp_agent_session_id !== null) record.acpAgentSessionId = row.acp_agent_session_id;
  if (row.claude_session_id !== null) record.claudeSessionId = row.claude_session_id;
  if (row.parent_session_id !== null) record.parentSessionId = row.parent_session_id;
  if (row.root_session_id !== null) record.rootSessionId = row.root_session_id;
  if (row.correlation_id !== null) record.correlationId = row.correlation_id;
  if (row.resume_from_session_id !== null) record.resumeFromSessionId = row.resume_from_session_id;
  if (row.current_backend_run_id !== null) record.currentBackendRunId = row.current_backend_run_id;

  const closedAt = parseOptionalTimestamp(row.closed_at, 'closed_at');
  if (closedAt !== undefined) record.closedAt = closedAt;
  const failedAt = parseOptionalTimestamp(row.failed_at, 'failed_at');
  if (failedAt !== undefined) record.failedAt = failedAt;
  const backendMetadata = parseBackendMetadata(row.backend_metadata);
  if (backendMetadata !== undefined) record.backendMetadata = backendMetadata;

  return record;
}

function parseStatus(status: string): AcpSessionStatus {
  switch (status) {
    case 'initializing':
    case 'idle':
    case 'running':
    case 'paused':
    case 'intervening':
    case 'closing':
    case 'closed':
    case 'failed':
      return status;
    default:
      throw new Error(`PostgresAcpSessionStore: invalid ACP session status in row: ${status}`);
  }
}

function parseRequiredTimestamp(value: string | number, columnName: string): number {
  const timestamp = parseOptionalTimestamp(value, columnName);
  if (timestamp === undefined) {
    throw new Error(`PostgresAcpSessionStore: missing required timestamp column ${columnName}`);
  }
  return timestamp;
}

function parseOptionalTimestamp(
  value: string | number | null,
  columnName: string
): number | undefined {
  if (value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`PostgresAcpSessionStore: invalid millisecond timestamp in ${columnName}`);
  }
  return parsed;
}

function parseBackendMetadata(value: unknown | null): AcpBackendMetadata | undefined {
  if (value === null || value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PostgresAcpSessionStore: backend_metadata must be valid JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error('PostgresAcpSessionStore: backend_metadata must be a JSON object');
  }

  const metadata: AcpBackendMetadata = {};
  for (const [key, metadataValue] of Object.entries(parsed)) {
    if (!isBackendMetadataValue(metadataValue)) {
      throw new Error(`PostgresAcpSessionStore: backend_metadata value is not primitive: ${key}`);
    }
    metadata[key] = metadataValue;
  }
  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBackendMetadataValue(value: unknown): value is AcpBackendMetadataValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

import { Pool, type QueryResultRow } from 'pg';

import type { ServiceHealth } from '../../container.js';
import { AcpDurableIdentityError, AcpValidationError } from './session-service.js';
import type { AcpSessionScope } from './types.js';
import {
  normalizeAcpPauseInterventionMetadata,
  validateAcpCompleteInterventionInput,
  validateAcpPauseSessionInput,
  validateAcpResumeSessionInput,
  validateAcpStartInterventionInput,
  type AcpCompleteInterventionInput,
  type AcpPauseInterventionRecord,
  type AcpPauseInterventionStatus,
  type AcpPauseInterventionStore,
  type AcpPauseSessionInput,
  type AcpResumeSessionInput,
  type AcpStartInterventionInput,
} from './pause-intervention.js';

export interface PostgresAcpPauseInterventionStoreConfig {
  url: string;
  schemaName?: string;
  tableName?: string;
  poolMax?: number;
}

interface AcpPauseInterventionRow extends QueryResultRow {
  pause_id: string;
  session_id: string;
  tenant_id: string;
  owner_key_id: string;
  status: string;
  idempotency_key: string | null;
  reason: string;
  requested_by: string;
  requested_at: Date | string;
  metadata: unknown;
  intervention_id: string | null;
  intervention_by: string | null;
  intervention_started_at: Date | string | null;
  intervention_completed_by: string | null;
  intervention_completed_at: Date | string | null;
  guidance: string | null;
  resume_id: string | null;
  resumed_by: string | null;
  resumed_at: Date | string | null;
  resume_metadata: unknown;
  updated_at: Date | string;
}

const DEFAULT_SCHEMA = 'public';
const DEFAULT_TABLE = 'acp_pause_interventions';
const DEFAULT_POOL_MAX = 5;
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class PostgresAcpPauseInterventionStore implements AcpPauseInterventionStore {
  private pool?: Pool;
  private readonly url: string;
  private readonly schemaName: string;
  private readonly tableName: string;
  private readonly poolMax: number;

  constructor(config: PostgresAcpPauseInterventionStoreConfig) {
    this.url = config.url;
    this.schemaName = config.schemaName ?? DEFAULT_SCHEMA;
    this.tableName = config.tableName ?? DEFAULT_TABLE;
    this.poolMax = config.poolMax ?? DEFAULT_POOL_MAX;

    validateIdentifier(this.schemaName, 'schema name');
    validateIdentifier(this.tableName, 'table name');
    validatePoolMax(this.poolMax);
  }

  async start(): Promise<void> {
    const pool = this.pool ?? new Pool({ connectionString: this.url, max: this.poolMax });
    this.pool = pool;
    try {
      await this.ensureSchema();
      const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      if (!result.rows[0]) {
        throw new Error('PostgresAcpPauseInterventionStore: connection test failed');
      }
    } catch (error) {
      this.pool = undefined;
      await pool.end().catch(() => {});
      throw error;
    }
  }

  async stop(_signal?: AbortSignal): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    if (pool !== undefined) await pool.end();
  }

  async health(): Promise<ServiceHealth> {
    const pool = this.pool;
    if (pool === undefined) {
      return { healthy: false, details: 'postgres ACP pause/intervention store not started' };
    }
    try {
      await pool.query('SELECT 1');
      return { healthy: true, details: 'postgres ACP pause/intervention store ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, details: `postgres ACP pause/intervention store: ${message}` };
    }
  }

  async pause(input: AcpPauseSessionInput): Promise<AcpPauseInterventionRecord> {
    validateAcpPauseSessionInput(input);
    const metadata = normalizeAcpPauseInterventionMetadata(input.metadata) ?? {};
    if (input.idempotencyKey !== undefined) {
      const existing = await this.findByIdempotencyKey(input);
      if (existing) return existing;
    }

    try {
      const result = await this.requirePool().query<AcpPauseInterventionRow>(
        `INSERT INTO ${this.qt()} (
           pause_id,
           session_id,
           tenant_id,
           owner_key_id,
           idempotency_key,
           reason,
           requested_by,
           requested_at,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9)
         ON CONFLICT (pause_id) DO NOTHING
         RETURNING ${returningColumns()}`,
        [
          input.pauseId,
          input.sessionId,
          input.tenantId,
          input.ownerKeyId,
          input.idempotencyKey,
          input.reason,
          input.requestedBy,
          input.requestedAt,
          metadata,
        ]
      );
      if (!result.rows[0]) {
        throw new AcpDurableIdentityError(`ACP pause id already exists: ${input.pauseId}`);
      }
      const record = rowToRecord(result.rows[0]);
      assertRecordMatchesPauseInput(record, input);
      return record;
    } catch (error) {
      if (input.idempotencyKey !== undefined && isPgUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(input);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getActive(sessionId: string, scope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null> {
    validateSessionIdAndScope(sessionId, scope);
    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `SELECT ${returningColumns()}
       FROM ${this.qt()}
       WHERE session_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
         AND status IN ('paused', 'intervening')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [sessionId, scope.tenantId, scope.ownerKeyId]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, sessionId, scope);
    return record;
  }

  async getLatest(sessionId: string, scope: AcpSessionScope): Promise<AcpPauseInterventionRecord | null> {
    validateSessionIdAndScope(sessionId, scope);
    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `SELECT ${returningColumns()}
       FROM ${this.qt()}
       WHERE session_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
       ORDER BY updated_at DESC
       LIMIT 1`,
      [sessionId, scope.tenantId, scope.ownerKeyId]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, sessionId, scope);
    return record;
  }

  async startIntervention(input: AcpStartInterventionInput): Promise<AcpPauseInterventionRecord | null> {
    validateAcpStartInterventionInput(input);
    const existing = await this.findByInterventionId(input.interventionId, input);
    if (existing) return existing;

    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `UPDATE ${this.qt()}
       SET status = 'intervening',
           intervention_id = $4,
           intervention_by = $5,
           intervention_started_at = COALESCE($6, NOW()),
           intervention_completed_by = NULL,
           intervention_completed_at = NULL,
           guidance = NULL,
           updated_at = COALESCE($6, NOW())
       WHERE session_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
         AND status = 'paused'
         AND intervention_id IS NULL
       RETURNING ${returningColumns()}`,
      [input.sessionId, input.tenantId, input.ownerKeyId, input.interventionId, input.interventionBy, input.startedAt]
    );
    if (!result.rows[0]) return this.findByInterventionId(input.interventionId, input);
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, input.sessionId, input);
    return record;
  }

  async completeIntervention(input: AcpCompleteInterventionInput): Promise<AcpPauseInterventionRecord | null> {
    validateAcpCompleteInterventionInput(input);
    const existing = await this.findByInterventionId(input.interventionId, input);
    if (existing?.interventionCompletedAt !== undefined) return existing;

    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `UPDATE ${this.qt()}
       SET status = 'paused',
           intervention_completed_by = $5,
           intervention_completed_at = COALESCE($6, NOW()),
           guidance = $7,
           updated_at = COALESCE($6, NOW())
       WHERE session_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
         AND intervention_id = $4
         AND status = 'intervening'
       RETURNING ${returningColumns()}`,
      [
        input.sessionId,
        input.tenantId,
        input.ownerKeyId,
        input.interventionId,
        input.completedBy,
        input.completedAt,
        input.guidance,
      ]
    );
    if (!result.rows[0]) return this.findByInterventionId(input.interventionId, input);
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, input.sessionId, input);
    return record;
  }

  async resume(input: AcpResumeSessionInput): Promise<AcpPauseInterventionRecord | null> {
    validateAcpResumeSessionInput(input);
    const existing = await this.findByResumeId(input.resumeId, input);
    if (existing) return existing;
    const resumeMetadata = normalizeAcpPauseInterventionMetadata(input.resumeMetadata, 'resume metadata') ?? {};

    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `UPDATE ${this.qt()}
       SET status = 'resumed',
           resume_id = $4,
           resumed_by = $5,
           resumed_at = COALESCE($6, NOW()),
           resume_metadata = $7,
           updated_at = COALESCE($6, NOW())
       WHERE session_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
         AND status IN ('paused', 'intervening')
       RETURNING ${returningColumns()}`,
      [
        input.sessionId,
        input.tenantId,
        input.ownerKeyId,
        input.resumeId,
        input.resumedBy,
        input.resumedAt,
        resumeMetadata,
      ]
    );
    if (!result.rows[0]) return this.findByResumeId(input.resumeId, input);
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, input.sessionId, input);
    return record;
  }

  private async findByIdempotencyKey(input: AcpPauseSessionInput): Promise<AcpPauseInterventionRecord | null> {
    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `SELECT ${returningColumns()}
       FROM ${this.qt()}
       WHERE tenant_id = $1
         AND owner_key_id = $2
         AND session_id = $3
         AND idempotency_key = $4
       ORDER BY requested_at ASC
       LIMIT 1`,
      [input.tenantId, input.ownerKeyId, input.sessionId, input.idempotencyKey]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, input.sessionId, input);
    return record;
  }

  private async findByInterventionId(
    interventionId: string,
    scope: AcpSessionScope & { sessionId: string }
  ): Promise<AcpPauseInterventionRecord | null> {
    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `SELECT ${returningColumns()}
       FROM ${this.qt()}
       WHERE tenant_id = $1
         AND owner_key_id = $2
         AND session_id = $3
         AND intervention_id = $4
       LIMIT 1`,
      [scope.tenantId, scope.ownerKeyId, scope.sessionId, interventionId]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, scope.sessionId, scope);
    return record;
  }

  private async findByResumeId(
    resumeId: string,
    scope: AcpSessionScope & { sessionId: string }
  ): Promise<AcpPauseInterventionRecord | null> {
    const result = await this.requirePool().query<AcpPauseInterventionRow>(
      `SELECT ${returningColumns()}
       FROM ${this.qt()}
       WHERE tenant_id = $1
         AND owner_key_id = $2
         AND session_id = $3
         AND resume_id = $4
       LIMIT 1`,
      [scope.tenantId, scope.ownerKeyId, scope.sessionId, resumeId]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertRecordMatchesSessionScope(record, scope.sessionId, scope);
    return record;
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error('PostgresAcpPauseInterventionStore: start() must be called before use');
    }
    return this.pool;
  }

  private qt(): string {
    return `"${this.schemaName}"."${this.tableName}"`;
  }

  private async ensureSchema(): Promise<void> {
    await this.requirePool().query(`CREATE SCHEMA IF NOT EXISTS "${this.schemaName}"`);
    await this.requirePool().query(`
      CREATE TABLE IF NOT EXISTS ${this.qt()} (
        pause_id                  TEXT PRIMARY KEY,
        session_id                TEXT NOT NULL,
        tenant_id                 TEXT NOT NULL,
        owner_key_id              TEXT NOT NULL,
        status                    TEXT NOT NULL DEFAULT 'paused'
          CHECK (status IN ('paused', 'intervening', 'resumed')),
        idempotency_key           TEXT,
        reason                    TEXT NOT NULL,
        requested_by              TEXT NOT NULL,
        requested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata                  JSONB NOT NULL DEFAULT '{}',
        intervention_id           TEXT,
        intervention_by           TEXT,
        intervention_started_at   TIMESTAMPTZ,
        intervention_completed_by TEXT,
        intervention_completed_at TIMESTAMPTZ,
        guidance                  TEXT,
        resume_id                 TEXT,
        resumed_by                TEXT,
        resumed_at                TIMESTAMPTZ,
        resume_metadata           JSONB,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.requirePool().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_${this.tableName}_scoped_idempotency"
      ON ${this.qt()} (tenant_id, owner_key_id, session_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
    await this.requirePool().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_${this.tableName}_active_session"
      ON ${this.qt()} (tenant_id, owner_key_id, session_id)
      WHERE status IN ('paused', 'intervening')
    `);
    await this.requirePool().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_${this.tableName}_intervention_id"
      ON ${this.qt()} (tenant_id, owner_key_id, session_id, intervention_id)
      WHERE intervention_id IS NOT NULL
    `);
    await this.requirePool().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_${this.tableName}_resume_id"
      ON ${this.qt()} (tenant_id, owner_key_id, session_id, resume_id)
      WHERE resume_id IS NOT NULL
    `);
  }
}

function returningColumns(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return [
    'pause_id',
    'session_id',
    'tenant_id',
    'owner_key_id',
    'status',
    'idempotency_key',
    'reason',
    'requested_by',
    'requested_at',
    'metadata',
    'intervention_id',
    'intervention_by',
    'intervention_started_at',
    'intervention_completed_by',
    'intervention_completed_at',
    'guidance',
    'resume_id',
    'resumed_by',
    'resumed_at',
    'resume_metadata',
    'updated_at',
  ]
    .map(column => `${prefix}${column}`)
    .join(', ');
}

function rowToRecord(row: AcpPauseInterventionRow): AcpPauseInterventionRecord {
  return {
    pauseId: row.pause_id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    ownerKeyId: row.owner_key_id,
    status: parseStatus(row.status),
    idempotencyKey: nullableString(row.idempotency_key),
    reason: row.reason,
    requestedBy: row.requested_by,
    requestedAt: toDate(row.requested_at, 'requested_at'),
    metadata: normalizeAcpPauseInterventionMetadata(row.metadata),
    interventionId: nullableString(row.intervention_id),
    interventionBy: nullableString(row.intervention_by),
    interventionStartedAt: nullableDate(row.intervention_started_at, 'intervention_started_at'),
    interventionCompletedBy: nullableString(row.intervention_completed_by),
    interventionCompletedAt: nullableDate(row.intervention_completed_at, 'intervention_completed_at'),
    guidance: nullableString(row.guidance),
    resumeId: nullableString(row.resume_id),
    resumedBy: nullableString(row.resumed_by),
    resumedAt: nullableDate(row.resumed_at, 'resumed_at'),
    resumeMetadata: normalizeAcpPauseInterventionMetadata(row.resume_metadata, 'resume metadata'),
    updatedAt: toDate(row.updated_at, 'updated_at'),
  };
}

function parseStatus(status: string): AcpPauseInterventionStatus {
  switch (status) {
    case 'paused':
    case 'intervening':
    case 'resumed':
      return status;
    default:
      throw new AcpValidationError(`ACP pause/intervention status is not supported: ${status}`);
  }
}

function assertRecordMatchesPauseInput(
  record: AcpPauseInterventionRecord,
  input: AcpPauseSessionInput
): void {
  if (
    record.pauseId !== input.pauseId ||
    record.sessionId !== input.sessionId ||
    record.tenantId !== input.tenantId ||
    record.ownerKeyId !== input.ownerKeyId
  ) {
    throw new AcpDurableIdentityError('ACP pause/intervention row does not match requested scope');
  }
}

function assertRecordMatchesSessionScope(
  record: AcpPauseInterventionRecord,
  sessionId: string,
  scope: AcpSessionScope
): void {
  if (
    record.sessionId !== sessionId ||
    record.tenantId !== scope.tenantId ||
    record.ownerKeyId !== scope.ownerKeyId
  ) {
    throw new AcpDurableIdentityError('ACP pause/intervention row does not match requested scope');
  }
}

function nullableString(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

function nullableDate(value: Date | string | null, label: string): Date | undefined {
  return value === null ? undefined : toDate(value, label);
}

function toDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AcpValidationError(`ACP pause/intervention timestamp is invalid: ${label}`);
  }
  return date;
}

function validateSessionIdAndScope(sessionId: string, scope: AcpSessionScope): void {
  assertNonEmptyString(sessionId, 'session id');
  assertNonEmptyString(scope.tenantId, 'tenant id');
  assertNonEmptyString(scope.ownerKeyId, 'owner key id');
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AcpValidationError(`ACP ${label} must be a non-empty string`);
  }
}

function validateIdentifier(identifier: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `PostgresAcpPauseInterventionStore: invalid ${label} "${identifier}" — must match [a-zA-Z_][a-zA-Z0-9_]*`
    );
  }
}

function validatePoolMax(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('PostgresAcpPauseInterventionStore: poolMax must be a positive safe integer');
  }
}

function isPgUniqueViolation(error: unknown): boolean {
  return hasErrorCode(error) && error.code === '23505';
}

function hasErrorCode(error: unknown): error is { code: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

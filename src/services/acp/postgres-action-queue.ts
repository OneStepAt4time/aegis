import { Pool, type QueryResultRow } from 'pg';

import { AcpDurableIdentityError, AcpValidationError, validateAcpControlActionInput } from './session-service.js';
import type { AcpControlActionInput, AcpControlActionType, AcpSessionScope } from './types.js';
import {
  normalizeAcpActionMetadata,
  type AcpActionMetadata,
  type AcpActionQueue,
  type AcpActionRecord,
  type AcpActionStatus,
  type AcpCancelActionOptions,
  type AcpCompleteActionOptions,
  type AcpEnqueueActionOptions,
  type AcpFailActionOptions,
  type AcpLeaseActionOptions,
} from './action-queue.js';

export interface PostgresAcpActionQueueConfig {
  url: string;
  schemaName?: string;
  tableName?: string;
  poolMax?: number;
}

interface AcpActionRow extends QueryResultRow {
  action_id: string;
  session_id: string;
  tenant_id: string;
  owner_key_id: string;
  action_type: string;
  idempotency_key: string | null;
  status: string;
  created_at: Date | string;
  available_at: Date | string;
  leased_until: Date | string | null;
  attempt_count: number;
  approval_id: string | null;
  control_request_id: string | null;
  metadata: unknown;
  result_metadata: unknown;
  error_metadata: unknown;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
  cancelled_at: Date | string | null;
}

const DEFAULT_SCHEMA = 'public';
const DEFAULT_TABLE = 'acp_actions';
const DEFAULT_POOL_MAX = 5;
const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class PostgresAcpActionQueue implements AcpActionQueue {
  private pool?: Pool;
  private readonly url: string;
  private readonly schemaName: string;
  private readonly tableName: string;
  private readonly poolMax: number;

  constructor(config: PostgresAcpActionQueueConfig) {
    this.url = config.url;
    this.schemaName = config.schemaName ?? DEFAULT_SCHEMA;
    this.tableName = config.tableName ?? DEFAULT_TABLE;
    this.poolMax = config.poolMax ?? DEFAULT_POOL_MAX;

    validateIdentifier(this.schemaName, 'schema name');
    validateIdentifier(this.tableName, 'table name');
    validatePoolMax(this.poolMax);
  }

  async start(): Promise<void> {
    const pool = this.pool ?? new Pool({
      connectionString: this.url,
      max: this.poolMax,
    });
    this.pool = pool;
    try {
      await this.ensureSchema();
      const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      if (!result.rows[0]) {
        throw new Error('PostgresAcpActionQueue: connection test failed');
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
    if (pool !== undefined) {
      await pool.end();
    }
  }

  async enqueue(
    input: AcpControlActionInput,
    options: AcpEnqueueActionOptions = {}
  ): Promise<AcpActionRecord> {
    validateAcpControlActionInput(input);
    const metadata = normalizeAcpActionMetadata(input.metadata) ?? {};
    const availableAt = options.availableAt ?? new Date();
    assertValidDate(availableAt, 'action availableAt');
    const pool = this.requirePool();

    if (input.idempotencyKey !== undefined) {
      const existing = await this.findByIdempotencyKey(
        input.tenantId,
        input.ownerKeyId,
        input.sessionId,
        input.idempotencyKey
      );
      if (existing) return existing;
    }

    try {
      const result = await pool.query<AcpActionRow>(
        `INSERT INTO ${this.qt()} (
           action_id,
           session_id,
           tenant_id,
           owner_key_id,
           action_type,
           idempotency_key,
           available_at,
           metadata,
           approval_id,
           control_request_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (action_id) DO NOTHING
         RETURNING ${returningColumns()}`,
        [
          input.actionId,
          input.sessionId,
          input.tenantId,
          input.ownerKeyId,
          input.type,
          input.idempotencyKey,
          availableAt,
          metadata,
          input.approvalId,
          input.controlRequestId,
        ]
      );
      if (!result.rows[0]) {
        throw new AcpDurableIdentityError(`ACP action id already exists: ${input.actionId}`);
      }
      const record = rowToRecord(result.rows[0]);
      assertReturnedActionMatchesInput(record, input);
      return record;
    } catch (error) {
      if (input.idempotencyKey !== undefined && isPgUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(
          input.tenantId,
          input.ownerKeyId,
          input.sessionId,
          input.idempotencyKey
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  async leaseNext(
    scope: AcpSessionScope,
    options: AcpLeaseActionOptions
  ): Promise<AcpActionRecord | null> {
    validateScope(scope);
    const now = options.now ?? new Date();
    assertValidDate(now, 'action lease now');
    assertValidDate(options.leaseUntil, 'action leaseUntil');
    if (options.leaseUntil.getTime() <= now.getTime()) {
      throw new AcpValidationError('ACP action leaseUntil must be after now');
    }
    const result = await this.requirePool().query<AcpActionRow>(
      `WITH candidate AS (
         SELECT action_id
         FROM ${this.qt()}
         WHERE tenant_id = $1
           AND owner_key_id = $2
           AND status = 'queued'
           AND available_at <= $3
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE ${this.qt()} AS actions
       SET status = 'leased',
           leased_until = $4,
           attempt_count = attempt_count + 1
       FROM candidate
       WHERE actions.action_id = candidate.action_id
       RETURNING ${returningColumns('actions')}`,
      [scope.tenantId, scope.ownerKeyId, now, options.leaseUntil]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertReturnedActionMatchesScope(record, scope);
    return record;
  }

  async complete(
    actionId: string,
    scope: AcpSessionScope,
    options: AcpCompleteActionOptions = {}
  ): Promise<AcpActionRecord | null> {
    validateActionIdAndScope(actionId, scope);
    const now = options.now ?? new Date();
    assertValidDate(now, 'action completion time');
    const resultMetadata = normalizeAcpActionMetadata(
      options.resultMetadata,
      'action result metadata'
    );
    const result = await this.requirePool().query<AcpActionRow>(
      `UPDATE ${this.qt()}
       SET status = 'completed',
           result_metadata = $4,
           completed_at = $5,
           leased_until = NULL
       WHERE action_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
         AND status = 'leased'
       RETURNING ${returningColumns()}`,
      [actionId, scope.tenantId, scope.ownerKeyId, resultMetadata, now]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertReturnedActionMatchesActionScope(record, actionId, scope);
    return record;
  }

  async fail(
    actionId: string,
    scope: AcpSessionScope,
    options: AcpFailActionOptions = {}
  ): Promise<AcpActionRecord | null> {
    validateActionIdAndScope(actionId, scope);
    const now = options.now ?? new Date();
    assertValidDate(now, 'action failure time');
    const errorMetadata = normalizeAcpActionMetadata(options.errorMetadata, 'action error metadata');
    const result = await this.requirePool().query<AcpActionRow>(
      `UPDATE ${this.qt()}
       SET status = 'failed',
           error_metadata = $4,
           failed_at = $5,
           leased_until = NULL
       WHERE action_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
         AND status = 'leased'
       RETURNING ${returningColumns()}`,
      [actionId, scope.tenantId, scope.ownerKeyId, errorMetadata, now]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertReturnedActionMatchesActionScope(record, actionId, scope);
    return record;
  }

  async cancel(
    actionId: string,
    scope: AcpSessionScope,
    options: AcpCancelActionOptions = {}
  ): Promise<AcpActionRecord | null> {
    validateActionIdAndScope(actionId, scope);
    const now = options.now ?? new Date();
    assertValidDate(now, 'action cancellation time');
    const errorMetadata = normalizeAcpActionMetadata(options.errorMetadata, 'action error metadata');
    const result = await this.requirePool().query<AcpActionRow>(
      `UPDATE ${this.qt()}
       SET status = 'cancelled',
           error_metadata = $4,
           cancelled_at = $5,
           leased_until = NULL
       WHERE action_id = $1
         AND tenant_id = $2
         AND owner_key_id = $3
         AND status IN ('queued', 'leased')
       RETURNING ${returningColumns()}`,
      [actionId, scope.tenantId, scope.ownerKeyId, errorMetadata, now]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertReturnedActionMatchesActionScope(record, actionId, scope);
    return record;
  }

  private async findByIdempotencyKey(
    tenantId: string,
    ownerKeyId: string,
    sessionId: string,
    idempotencyKey: string
  ): Promise<AcpActionRecord | null> {
    const result = await this.requirePool().query<AcpActionRow>(
      `SELECT ${returningColumns()}
       FROM ${this.qt()}
       WHERE tenant_id = $1
         AND owner_key_id = $2
         AND session_id = $3
         AND idempotency_key = $4
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenantId, ownerKeyId, sessionId, idempotencyKey]
    );
    if (!result.rows[0]) return null;
    const record = rowToRecord(result.rows[0]);
    assertReturnedActionMatchesIdempotencyLookup(record, {
      tenantId,
      ownerKeyId,
      sessionId,
      idempotencyKey,
    });
    return record;
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error('PostgresAcpActionQueue: start() must be called before use');
    }
    return this.pool;
  }

  private qt(): string {
    return `"${this.schemaName}"."${this.tableName}"`;
  }

  private async ensureSchema(): Promise<void> {
    await this.requirePool().query(`
      CREATE SCHEMA IF NOT EXISTS "${this.schemaName}"
    `);
    await this.requirePool().query(`
      CREATE TABLE IF NOT EXISTS ${this.qt()} (
        action_id          TEXT PRIMARY KEY,
        session_id         TEXT NOT NULL,
        tenant_id          TEXT NOT NULL,
        owner_key_id       TEXT NOT NULL,
        action_type        TEXT NOT NULL,
        idempotency_key    TEXT,
        status             TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'leased', 'completed', 'failed', 'cancelled')),
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        available_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        leased_until       TIMESTAMPTZ,
        attempt_count      INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        approval_id        TEXT,
        control_request_id TEXT,
        metadata           JSONB NOT NULL DEFAULT '{}',
        result_metadata    JSONB,
        error_metadata     JSONB,
        completed_at       TIMESTAMPTZ,
        failed_at          TIMESTAMPTZ,
        cancelled_at       TIMESTAMPTZ
      )
    `);
    await this.requirePool().query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uniq_${this.tableName}_scoped_idempotency"
      ON ${this.qt()} (tenant_id, owner_key_id, session_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);
    await this.requirePool().query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_lease"
      ON ${this.qt()} (tenant_id, owner_key_id, status, available_at, created_at)
    `);
  }
}

function validateIdentifier(identifier: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `PostgresAcpActionQueue: invalid ${label} "${identifier}" — must match [a-zA-Z_][a-zA-Z0-9_]*`
    );
  }
}

function validatePoolMax(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('PostgresAcpActionQueue: poolMax must be a positive safe integer');
  }
}

function returningColumns(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return [
    'action_id',
    'session_id',
    'tenant_id',
    'owner_key_id',
    'action_type',
    'idempotency_key',
    'status',
    'created_at',
    'available_at',
    'leased_until',
    'attempt_count',
    'approval_id',
    'control_request_id',
    'metadata',
    'result_metadata',
    'error_metadata',
    'completed_at',
    'failed_at',
    'cancelled_at',
  ]
    .map(column => `${prefix}${column}`)
    .join(', ');
}

function rowToRecord(row: AcpActionRow): AcpActionRecord {
  return {
    actionId: row.action_id,
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    ownerKeyId: row.owner_key_id,
    actionType: parseActionType(row.action_type),
    idempotencyKey: nullableString(row.idempotency_key),
    status: parseActionStatus(row.status),
    createdAt: toDate(row.created_at, 'created_at'),
    availableAt: toDate(row.available_at, 'available_at'),
    leasedUntil: nullableDate(row.leased_until, 'leased_until'),
    attemptCount: row.attempt_count,
    approvalId: nullableString(row.approval_id),
    controlRequestId: nullableString(row.control_request_id),
    metadata: normalizeAcpActionMetadata(row.metadata),
    resultMetadata: normalizeAcpActionMetadata(row.result_metadata, 'action result metadata'),
    errorMetadata: normalizeAcpActionMetadata(row.error_metadata, 'action error metadata'),
    completedAt: nullableDate(row.completed_at, 'completed_at'),
    failedAt: nullableDate(row.failed_at, 'failed_at'),
    cancelledAt: nullableDate(row.cancelled_at, 'cancelled_at'),
  };
}

function assertReturnedActionMatchesInput(
  record: AcpActionRecord,
  input: AcpControlActionInput
): void {
  if (
    record.actionId !== input.actionId ||
    record.sessionId !== input.sessionId ||
    record.tenantId !== input.tenantId ||
    record.ownerKeyId !== input.ownerKeyId ||
    record.actionType !== input.type
  ) {
    throw new AcpDurableIdentityError('ACP action row does not match requested action scope');
  }
}

function assertReturnedActionMatchesIdempotencyLookup(
  record: AcpActionRecord,
  lookup: AcpSessionScope & { sessionId: string; idempotencyKey: string }
): void {
  if (
    record.tenantId !== lookup.tenantId ||
    record.ownerKeyId !== lookup.ownerKeyId ||
    record.sessionId !== lookup.sessionId ||
    record.idempotencyKey !== lookup.idempotencyKey
  ) {
    throw new AcpDurableIdentityError('ACP idempotency row does not match requested action scope');
  }
}

function assertReturnedActionMatchesScope(
  record: AcpActionRecord,
  scope: AcpSessionScope
): void {
  if (record.tenantId !== scope.tenantId || record.ownerKeyId !== scope.ownerKeyId) {
    throw new AcpDurableIdentityError('ACP action row does not match requested action scope');
  }
}

function assertReturnedActionMatchesActionScope(
  record: AcpActionRecord,
  actionId: string,
  scope: AcpSessionScope
): void {
  if (record.actionId !== actionId) {
    throw new AcpDurableIdentityError('ACP action row does not match requested action scope');
  }
  assertReturnedActionMatchesScope(record, scope);
}

function parseActionStatus(status: string): AcpActionStatus {
  switch (status) {
    case 'queued':
    case 'leased':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return status;
    default:
      throw new AcpValidationError(`ACP action status is not supported: ${status}`);
  }
}

function parseActionType(actionType: string): AcpControlActionType {
  switch (actionType) {
    case 'prompt':
    case 'approve':
    case 'reject':
    case 'pause':
    case 'resume':
    case 'cancel':
    case 'driver_transfer':
    case 'intervene':
    case 'close':
      return actionType;
    default:
      throw new AcpValidationError(`ACP action type is not supported: ${actionType}`);
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
    throw new AcpValidationError(`ACP action timestamp is invalid: ${label}`);
  }
  return date;
}

function validateActionIdAndScope(actionId: string, scope: AcpSessionScope): void {
  assertNonEmptyString(actionId, 'action id');
  validateScope(scope);
}

function validateScope(scope: AcpSessionScope): void {
  assertNonEmptyString(scope.tenantId, 'tenant id');
  assertNonEmptyString(scope.ownerKeyId, 'owner key id');
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AcpValidationError(`ACP ${label} must be a non-empty string`);
  }
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AcpValidationError(`ACP ${label} must be a valid Date`);
  }
}

function isPgUniqueViolation(error: unknown): boolean {
  return hasErrorCode(error) && error.code === '23505';
}

function hasErrorCode(error: unknown): error is { code: unknown } {
  return typeof error === 'object' && error !== null && 'code' in error;
}

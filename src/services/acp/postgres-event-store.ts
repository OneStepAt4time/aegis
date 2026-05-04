import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { ServiceHealth } from '../../container.js';
import type {
  AcpAppendEventInput,
  AcpEventPayload,
  AcpEventRecord,
  AcpEventStore,
  AcpListEventsInput,
} from './event-store.js';

export interface PostgresAcpEventStoreConfig {
  url: string;
  schemaName?: string;
  tableName?: string;
  poolMax?: number;
}

interface AcpEventRow {
  session_id: string;
  tenant_id: string;
  owner_key_id: string;
  event_seq: string | number;
  event_id: string;
  backend_run_id: string | null;
  event_type: string;
  occurred_at: Date | string;
  ingested_at: Date | string;
  payload: AcpEventPayload;
  payload_ref: string | null;
}

const DEFAULT_SCHEMA = 'public';
const DEFAULT_TABLE = 'aegis_acp_events';
const DEFAULT_POOL_MAX = 5;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1_000;
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class PostgresAcpEventStore implements AcpEventStore {
  private pool: Pool | undefined;
  private readonly url: string;
  private readonly schemaName: string;
  private readonly tableName: string;
  private readonly poolMax: number;

  constructor(config: PostgresAcpEventStoreConfig) {
    this.url = config.url;
    this.schemaName = config.schemaName ?? DEFAULT_SCHEMA;
    this.tableName = config.tableName ?? DEFAULT_TABLE;
    this.poolMax = config.poolMax ?? DEFAULT_POOL_MAX;

    validateIdentifier('schema name', this.schemaName);
    validateIdentifier('table name', this.tableName);
    validatePoolMax(this.poolMax);
  }

  async start(): Promise<void> {
    if (this.pool !== undefined) return;
    const pool = new Pool({
      connectionString: this.url,
      max: this.poolMax,
    });
    this.pool = pool;
    try {
      await this.ensureSchema();
      const result = await pool.query('SELECT 1 AS ok');
      if (!result.rows[0]) {
        throw new Error('PostgresAcpEventStore: connection test failed');
      }
    } catch (error) {
      this.pool = undefined;
      await pool.end().catch(() => {});
      throw error;
    }
  }

  async stop(_signal: AbortSignal): Promise<void> {
    const pool = this.pool;
    this.pool = undefined;
    if (pool !== undefined) {
      await pool.end();
    }
  }

  async health(): Promise<ServiceHealth> {
    const pool = this.pool;
    if (pool === undefined) {
      return { healthy: false, details: 'postgres ACP event store not started' };
    }

    try {
      await pool.query('SELECT 1');
      return { healthy: true, details: 'postgres ACP event store ok' };
    } catch (error) {
      return { healthy: false, details: `postgres ACP event store: ${toError(error).message}` };
    }
  }

  async append(input: AcpAppendEventInput): Promise<AcpEventRecord> {
    const validated = validateAppendInput(input);
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)",
        [validated.sessionId],
      );
      const scopeConflict = await client.query<{ tenant_id: string; owner_key_id: string }>(
        `
          SELECT tenant_id, owner_key_id
          FROM ${this.qt()}
          WHERE session_id = $1
            AND (tenant_id <> $2 OR owner_key_id <> $3)
          LIMIT 1
        `,
        [validated.sessionId, validated.tenantId, validated.ownerKeyId],
      );
      if (scopeConflict.rows[0] !== undefined) {
        throw new Error('PostgresAcpEventStore: session scope does not match existing event stream');
      }
      const result = await client.query<AcpEventRow>(
        `
          WITH next_event AS (
            SELECT COALESCE(MAX(event_seq), 0) + 1 AS event_seq
            FROM ${this.qt()}
            WHERE session_id = $1
          )
          INSERT INTO ${this.qt()} (
            session_id,
            tenant_id,
            owner_key_id,
            event_seq,
            event_id,
            backend_run_id,
            event_type,
            occurred_at,
            payload,
            payload_ref
          )
          SELECT
            $1,
            $2,
            $3,
            next_event.event_seq,
            $4,
            $5,
            $6,
            $7,
            $8::jsonb,
            $9
          FROM next_event
          RETURNING
            session_id,
            tenant_id,
            owner_key_id,
            event_seq,
            event_id,
            backend_run_id,
            event_type,
            occurred_at,
            ingested_at,
            payload,
            payload_ref
        `,
        [
          validated.sessionId,
          validated.tenantId,
          validated.ownerKeyId,
          randomUUID(),
          validated.backendRunId ?? null,
          validated.eventType,
          validated.occurredAt,
          validated.payloadJson,
          validated.payloadRef ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('PostgresAcpEventStore: append returned no event row');
      }
      await client.query('COMMIT');
      return mapEventRow(row);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(input: AcpListEventsInput): Promise<AcpEventRecord[]> {
    validateListInput(input);
    const afterEventSeq = resolveAfterEventSeq(input.afterEventSeq);
    const limit = resolveLimit(input.limit);
    const result = await this.requirePool().query<AcpEventRow>(
      `
        SELECT
          session_id,
          tenant_id,
          owner_key_id,
          event_seq,
          event_id,
          backend_run_id,
          event_type,
          occurred_at,
          ingested_at,
          payload,
          payload_ref
        FROM ${this.qt()}
        WHERE session_id = $1
          AND tenant_id = $2
          AND owner_key_id = $3
          AND event_seq > $4
        ORDER BY event_seq ASC
        LIMIT $5
      `,
      [
        input.sessionId,
        input.tenantId,
        input.ownerKeyId,
        afterEventSeq,
        limit,
      ],
    );
    return result.rows.map(mapEventRow);
  }

  private qt(): string {
    return `"${this.schemaName}"."${this.tableName}"`;
  }

  private requirePool(): Pool {
    if (this.pool === undefined) {
      throw new Error('PostgresAcpEventStore: store has not been started');
    }
    return this.pool;
  }

  private async ensureSchema(): Promise<void> {
    const pool = this.requirePool();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schemaName}"`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.qt()} (
        session_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        owner_key_id TEXT NOT NULL,
        event_seq BIGINT NOT NULL CHECK (event_seq > 0),
        event_id TEXT NOT NULL,
        backend_run_id TEXT,
        event_type TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        payload JSONB NOT NULL,
        payload_ref TEXT,
        PRIMARY KEY (session_id, event_seq),
        UNIQUE (event_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_scope_replay"
      ON ${this.qt()} (tenant_id, owner_key_id, session_id, event_seq)
    `);
  }
}

function validateIdentifier(label: string, value: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`PostgresAcpEventStore: invalid ${label} "${value}" — must match [a-zA-Z_][a-zA-Z0-9_]*`);
  }
}

function validatePoolMax(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('PostgresAcpEventStore: poolMax must be a positive safe integer');
  }
}

interface ValidatedAppendInput extends Omit<AcpAppendEventInput, 'payload' | 'occurredAt'> {
  occurredAt: Date;
  payloadJson: string;
}

function validateAppendInput(input: AcpAppendEventInput): ValidatedAppendInput {
  return {
    sessionId: requireNonEmptyString(input.sessionId, 'sessionId'),
    tenantId: requireNonEmptyString(input.tenantId, 'tenantId'),
    ownerKeyId: requireNonEmptyString(input.ownerKeyId, 'ownerKeyId'),
    backendRunId: requireOptionalNonEmptyString(input.backendRunId, 'backendRunId'),
    eventType: requireNonEmptyString(input.eventType, 'eventType'),
    occurredAt: resolveOccurredAt(input.occurredAt),
    payloadJson: serializePayload(input.payload),
    payloadRef: requireOptionalNonEmptyString(input.payloadRef, 'payloadRef'),
  };
}

function validateListInput(input: AcpListEventsInput): void {
  requireNonEmptyString(input.sessionId, 'sessionId');
  requireNonEmptyString(input.tenantId, 'tenantId');
  requireNonEmptyString(input.ownerKeyId, 'ownerKeyId');
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`PostgresAcpEventStore: ${label} must be a non-empty string`);
  }
  return value;
}

function requireOptionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, label);
}

function resolveOccurredAt(value: unknown): Date {
  if (value === undefined) return new Date();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('PostgresAcpEventStore: occurredAt must be a valid Date');
  }
  return value;
}

function serializePayload(payload: unknown): string {
  validateJsonValue(payload, 'payload', new WeakSet<object>());
  try {
    return JSON.stringify(payload);
  } catch (error) {
    throw new Error(`PostgresAcpEventStore: payload is not serializable JSON: ${toError(error).message}`);
  }
}

function validateJsonValue(value: unknown, path: string, seen: WeakSet<object>): asserts value is AcpEventPayload {
  if (value === null) return;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`PostgresAcpEventStore: payload number at ${path} must be finite`);
      }
      return;
    case 'object':
      validateJsonObjectOrArray(value, path, seen);
      return;
    case 'undefined':
      throw new Error(`PostgresAcpEventStore: payload value at ${path} must not be undefined`);
    case 'bigint':
    case 'function':
    case 'symbol':
    default:
      throw new Error(`PostgresAcpEventStore: payload value at ${path} has unsupported type ${typeof value}`);
  }
}

function validateJsonObjectOrArray(value: object, path: string, seen: WeakSet<object>): void {
  if (seen.has(value)) {
    throw new Error(`PostgresAcpEventStore: payload contains a circular reference at ${path}`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error(`PostgresAcpEventStore: payload array at ${path} must not contain holes`);
        }
        validateJsonValue(value[index], `${path}[${index}]`, seen);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`PostgresAcpEventStore: payload object at ${path} must be a plain JSON object`);
    }

    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function mapEventRow(row: AcpEventRow): AcpEventRecord {
  return {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    ownerKeyId: row.owner_key_id,
    eventSeq: parseEventSeq(row.event_seq),
    eventId: row.event_id,
    backendRunId: row.backend_run_id ?? undefined,
    eventType: row.event_type,
    occurredAt: toDate(row.occurred_at),
    ingestedAt: toDate(row.ingested_at),
    payload: row.payload,
    payloadRef: row.payload_ref ?? undefined,
  };
}

function parseEventSeq(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('PostgresAcpEventStore: invalid event_seq returned by Postgres');
  }
  return parsed;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function resolveAfterEventSeq(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('PostgresAcpEventStore: afterEventSeq must be a non-negative safe integer');
  }
  return value;
}

function resolveLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('PostgresAcpEventStore: limit must be a positive safe integer');
  }
  return Math.min(value, MAX_LIST_LIMIT);
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK').catch(() => {});
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

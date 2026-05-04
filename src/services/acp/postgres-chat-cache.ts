import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { ServiceHealth } from '../../container.js';
import type { AcpEventJsonValue } from './event-store.js';
import type {
  AcpChatCache,
  AcpChatSnapshotMessage,
  AcpChatSnapshotMetadata,
  AcpChatSnapshotRecord,
  AcpChatTokenUsage,
  AcpGetChatSnapshotInput,
  AcpSaveChatSnapshotInput,
} from './chat-cache.js';

export interface PostgresAcpChatCacheConfig {
  url: string;
  schemaName?: string;
  tableName?: string;
  poolMax?: number;
}

interface AcpChatSnapshotRow {
  session_id: string;
  tenant_id: string;
  owner_key_id: string;
  snapshot_id: string;
  transcript_id: string;
  snapshot_seq: string | number;
  from_event_seq: string | number;
  to_event_seq: string | number;
  created_at: Date | string;
  messages: AcpChatSnapshotMessage[];
  token_usage: AcpChatTokenUsage | null;
  metadata: AcpChatSnapshotMetadata | null;
}

interface ValidatedSaveInput extends Omit<AcpSaveChatSnapshotInput, 'messages' | 'tokenUsage' | 'metadata'> {
  messagesJson: string;
  tokenUsageJson: string | null;
  metadataJson: string | null;
}

const DEFAULT_SCHEMA = 'public';
const DEFAULT_TABLE = 'acp_chat_snapshots';
const DEFAULT_POOL_MAX = 5;
const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class PostgresAcpChatCache implements AcpChatCache {
  private pool: Pool | undefined;
  private readonly url: string;
  private readonly schemaName: string;
  private readonly tableName: string;
  private readonly poolMax: number;

  constructor(config: PostgresAcpChatCacheConfig) {
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
        throw new Error('PostgresAcpChatCache: connection test failed');
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

  async health(): Promise<ServiceHealth> {
    const pool = this.pool;
    if (pool === undefined) {
      return { healthy: false, details: 'postgres ACP chat cache not started' };
    }

    try {
      await pool.query('SELECT 1');
      return { healthy: true, details: 'postgres ACP chat cache ok' };
    } catch (error) {
      return { healthy: false, details: `postgres ACP chat cache: ${toError(error).message}` };
    }
  }

  async save(input: AcpSaveChatSnapshotInput): Promise<AcpChatSnapshotRecord> {
    const validated = validateSaveInput(input);
    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)",
        [`${validated.tenantId}:${validated.ownerKeyId}:${validated.sessionId}`],
      );

      const result = await client.query<AcpChatSnapshotRow>(
        `
          WITH next_snapshot AS (
            SELECT COALESCE(MAX(snapshot_seq), 0) + 1 AS snapshot_seq
            FROM ${this.qt()}
            WHERE session_id = $1
              AND tenant_id = $2
              AND owner_key_id = $3
          )
          INSERT INTO ${this.qt()} (
            session_id,
            tenant_id,
            owner_key_id,
            snapshot_id,
            transcript_id,
            snapshot_seq,
            from_event_seq,
            to_event_seq,
            messages,
            token_usage,
            metadata
          )
          SELECT
            $1,
            $2,
            $3,
            $4,
            $5,
            next_snapshot.snapshot_seq,
            $6,
            $7,
            $8::jsonb,
            $9::jsonb,
            $10::jsonb
          FROM next_snapshot
          RETURNING
            session_id,
            tenant_id,
            owner_key_id,
            snapshot_id,
            transcript_id,
            snapshot_seq,
            from_event_seq,
            to_event_seq,
            created_at,
            messages,
            token_usage,
            metadata
        `,
        [
          validated.sessionId,
          validated.tenantId,
          validated.ownerKeyId,
          randomUUID(),
          validated.transcriptId,
          validated.fromEventSeq,
          validated.toEventSeq,
          validated.messagesJson,
          validated.tokenUsageJson,
          validated.metadataJson,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('PostgresAcpChatCache: save returned no chat snapshot row');
      }
      await client.query('COMMIT');
      return mapSnapshotRow(row);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatest(input: AcpGetChatSnapshotInput): Promise<AcpChatSnapshotRecord | null> {
    validateGetInput(input);
    const params: unknown[] = [
      input.sessionId,
      input.tenantId,
      input.ownerKeyId,
      input.transcriptId,
    ];
    let eventPredicate = '';
    if (input.atOrBeforeEventSeq !== undefined) {
      eventPredicate = 'AND to_event_seq <= $5';
      params.push(input.atOrBeforeEventSeq);
    }

    const result = await this.requirePool().query<AcpChatSnapshotRow>(
      `
        SELECT
          session_id,
          tenant_id,
          owner_key_id,
          snapshot_id,
          transcript_id,
          snapshot_seq,
          from_event_seq,
          to_event_seq,
          created_at,
          messages,
          token_usage,
          metadata
        FROM ${this.qt()}
        WHERE session_id = $1
          AND tenant_id = $2
          AND owner_key_id = $3
          AND transcript_id = $4
          ${eventPredicate}
        ORDER BY to_event_seq DESC, snapshot_seq DESC
        LIMIT 1
      `,
      params,
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSnapshotRow(row);
  }

  private qt(): string {
    return `"${this.schemaName}"."${this.tableName}"`;
  }

  private requirePool(): Pool {
    if (this.pool === undefined) {
      throw new Error('PostgresAcpChatCache: cache has not been started');
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
        snapshot_id TEXT NOT NULL,
        transcript_id TEXT NOT NULL,
        snapshot_seq BIGINT NOT NULL CHECK (snapshot_seq > 0),
        from_event_seq BIGINT NOT NULL CHECK (from_event_seq > 0),
        to_event_seq BIGINT NOT NULL CHECK (to_event_seq > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        messages JSONB NOT NULL,
        token_usage JSONB,
        metadata JSONB,
        PRIMARY KEY (tenant_id, owner_key_id, session_id, snapshot_seq),
        UNIQUE (tenant_id, owner_key_id, snapshot_id),
        UNIQUE (tenant_id, owner_key_id, session_id, transcript_id, from_event_seq, to_event_seq),
        CONSTRAINT "${this.tableName}_event_range_check" CHECK (from_event_seq <= to_event_seq),
        CONSTRAINT "${this.tableName}_messages_array_check" CHECK (jsonb_typeof(messages) = 'array'),
        CONSTRAINT "${this.tableName}_token_usage_object_check" CHECK (token_usage IS NULL OR jsonb_typeof(token_usage) = 'object'),
        CONSTRAINT "${this.tableName}_metadata_object_check" CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object')
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "idx_${this.tableName}_scope_latest"
      ON ${this.qt()} (tenant_id, owner_key_id, session_id, transcript_id, to_event_seq DESC)
    `);
  }
}

function validateSaveInput(input: AcpSaveChatSnapshotInput): ValidatedSaveInput {
  const messages = validateMessages(input.messages);
  return {
    sessionId: requireNonEmptyString(input.sessionId, 'sessionId'),
    tenantId: requireNonEmptyString(input.tenantId, 'tenantId'),
    ownerKeyId: requireNonEmptyString(input.ownerKeyId, 'ownerKeyId'),
    transcriptId: requireNonEmptyString(input.transcriptId, 'transcriptId'),
    fromEventSeq: requirePositiveSafeInteger(input.fromEventSeq, 'fromEventSeq'),
    toEventSeq: requireToEventSeq(input.fromEventSeq, input.toEventSeq),
    messagesJson: serializeJson(messages, 'messages'),
    tokenUsageJson: serializeOptionalObject(input.tokenUsage, 'tokenUsage'),
    metadataJson: serializeOptionalObject(input.metadata, 'metadata'),
  };
}

function validateGetInput(input: AcpGetChatSnapshotInput): void {
  requireNonEmptyString(input.sessionId, 'sessionId');
  requireNonEmptyString(input.tenantId, 'tenantId');
  requireNonEmptyString(input.ownerKeyId, 'ownerKeyId');
  requireNonEmptyString(input.transcriptId, 'transcriptId');
  if (input.atOrBeforeEventSeq !== undefined) {
    requirePositiveSafeInteger(input.atOrBeforeEventSeq, 'atOrBeforeEventSeq');
  }
}

function validateIdentifier(label: string, value: string): void {
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`PostgresAcpChatCache: invalid ${label} "${value}" — must match [a-zA-Z_][a-zA-Z0-9_]*`);
  }
}

function validatePoolMax(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('PostgresAcpChatCache: poolMax must be a positive safe integer');
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`PostgresAcpChatCache: ${label} must be a non-empty string`);
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value <= 0) {
    throw new Error(`PostgresAcpChatCache: ${label} must be a positive safe integer`);
  }
  return value;
}

function requireToEventSeq(fromEventSeq: unknown, toEventSeq: unknown): number {
  const from = requirePositiveSafeInteger(fromEventSeq, 'fromEventSeq');
  const to = requirePositiveSafeInteger(toEventSeq, 'toEventSeq');
  if (to < from) {
    throw new Error('PostgresAcpChatCache: toEventSeq must be greater than or equal to fromEventSeq');
  }
  return to;
}

function validateMessages(value: unknown): AcpChatSnapshotMessage[] {
  if (!Array.isArray(value)) {
    throw new Error('PostgresAcpChatCache: messages must be an array');
  }
  validateJsonValue(value, 'messages', new WeakSet<object>());
  const messages: AcpChatSnapshotMessage[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const message = value[index];
    if (!isPlainRecord(message)) {
      throw new Error(`PostgresAcpChatCache: messages[${index}] must be a plain JSON object`);
    }
    messages.push(message);
  }
  return messages;
}

function serializeOptionalObject(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (!isPlainRecord(value)) {
    throw new Error(`PostgresAcpChatCache: ${label} must be a plain JSON object`);
  }
  return serializeJson(value, label);
}

function serializeJson(value: AcpEventJsonValue, label: string): string {
  validateJsonValue(value, label, new WeakSet<object>());
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new Error(`PostgresAcpChatCache: ${label} is not serializable JSON: ${toError(error).message}`);
  }
}

function validateJsonValue(value: unknown, path: string, seen: WeakSet<object>): asserts value is AcpEventJsonValue {
  if (value === null) return;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`PostgresAcpChatCache: JSON number at ${path} must be finite`);
      }
      return;
    case 'object':
      validateJsonObjectOrArray(value, path, seen);
      return;
    case 'undefined':
      throw new Error(`PostgresAcpChatCache: JSON value at ${path} must not be undefined`);
    case 'bigint':
    case 'function':
    case 'symbol':
    default:
      throw new Error(`PostgresAcpChatCache: JSON value at ${path} has unsupported type ${typeof value}`);
  }
}

function validateJsonObjectOrArray(value: object, path: string, seen: WeakSet<object>): void {
  if (seen.has(value)) {
    throw new Error(`PostgresAcpChatCache: JSON value contains a circular reference at ${path}`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error(`PostgresAcpChatCache: JSON array at ${path} must not contain holes`);
        }
        validateJsonValue(value[index], `${path}[${index}]`, seen);
      }
      return;
    }

    if (!isPlainRecord(value)) {
      throw new Error(`PostgresAcpChatCache: JSON object at ${path} must be a plain object`);
    }

    for (const [key, entry] of Object.entries(value)) {
      validateJsonValue(entry, `${path}.${key}`, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function isPlainRecord(value: unknown): value is Record<string, AcpEventJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mapSnapshotRow(row: AcpChatSnapshotRow): AcpChatSnapshotRecord {
  const record: AcpChatSnapshotRecord = {
    sessionId: row.session_id,
    tenantId: row.tenant_id,
    ownerKeyId: row.owner_key_id,
    snapshotId: row.snapshot_id,
    transcriptId: row.transcript_id,
    snapshotSeq: parseSequence(row.snapshot_seq, 'snapshot_seq'),
    fromEventSeq: parseSequence(row.from_event_seq, 'from_event_seq'),
    toEventSeq: parseSequence(row.to_event_seq, 'to_event_seq'),
    createdAt: toDate(row.created_at),
    messages: row.messages,
  };
  if (row.token_usage !== null) record.tokenUsage = row.token_usage;
  if (row.metadata !== null) record.metadata = row.metadata;
  return record;
}

function parseSequence(value: string | number, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`PostgresAcpChatCache: invalid ${label} returned by Postgres`);
  }
  return parsed;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure from the transaction body.
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

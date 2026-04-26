/**
 * PostgresStore.ts — PostgreSQL-backed session state store.
 *
 * Stores each session as a row with a JSONB `data` column containing the
 * full SerializedSessionInfo. Uses connection pooling and transactional
 * saves for atomic reconciliation.
 *
 * Configuration via environment variables (opt-in):
 *   AEGIS_SESSION_STORE=postgres     — enable Postgres backend
 *   AEGIS_POSTGRES_URL=postgresql://… — connection URL (required)
 *   AEGIS_PG_TABLE=aegis_sessions    — table name (default)
 *   AEGIS_PG_SCHEMA=public           — schema name (default)
 *   AEGIS_PG_POOL_MAX=5              — connection pool size (default)
 *
 * Issue #1937: Pluggable SessionStore interface.
 */

import { Pool, type PoolClient, type QueryResult } from 'pg';
import type { ServiceHealth } from '../../container.js';
import type {
  StateStore,
  SerializedSessionInfo,
  SerializedSessionState,
} from './state-store.js';

/** PostgreSQL store configuration. */
export interface PostgresStoreConfig {
  /** PostgreSQL connection string (postgresql://user:pass@host:port/db). */
  url: string;
  /** Table name for sessions (default: 'aegis_sessions'). */
  tableName?: string;
  /** Schema name (default: 'public'). */
  schemaName?: string;
  /** Connection pool max size (default: 5). */
  poolMax?: number;
}

const DEFAULT_TABLE = 'aegis_sessions';
const DEFAULT_SCHEMA = 'public';
const DEFAULT_POOL_MAX = 5;

/** Row shape returned from session queries. */
interface SessionRow {
  id: string;
  data: SerializedSessionInfo;
  created_at: string;
  updated_at: string;
}

/**
 * PostgreSQL-backed implementation of StateStore.
 *
 * Uses a `pg.Pool` for connection management. The table is created
 * automatically on start with CREATE TABLE IF NOT EXISTS.
 */
export class PostgresStore implements StateStore {
  private pool!: Pool;
  private readonly url: string;
  private readonly tableName: string;
  private readonly schemaName: string;
  private readonly poolMax: number;

  constructor(config: PostgresStoreConfig) {
    this.url = config.url;
    this.tableName = config.tableName ?? DEFAULT_TABLE;
    this.schemaName = config.schemaName ?? DEFAULT_SCHEMA;
    this.poolMax = config.poolMax ?? DEFAULT_POOL_MAX;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.pool = new Pool({
      connectionString: this.url,
      max: this.poolMax,
    });
    await this.ensureSchema();
    // Verify connectivity
    const result = await this.pool.query('SELECT 1 AS ok');
    if (!result.rows[0]) {
      throw new Error('PostgresStore: connection test failed');
    }
  }

  async stop(): Promise<void> {
    await this.pool.end();
  }

  async health(): Promise<ServiceHealth> {
    try {
      await this.pool.query('SELECT 1');
      return { healthy: true, details: 'postgres store ok' };
    } catch (err) {
      return { healthy: false, details: `postgres: ${(err as Error).message}` };
    }
  }

  // ── StateStore interface ───────────────────────────────────────────

  async load(): Promise<SerializedSessionState> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, data FROM ${this.qt()}`,
    );
    const sessions: Record<string, SerializedSessionInfo> = Object.create(null) as Record<
      string,
      SerializedSessionInfo
    >;
    for (const row of result.rows) {
      sessions[row.id] = row.data;
    }
    return { sessions };
  }

  async save(state: SerializedSessionState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current IDs
      const current = await client.query<{ id: string }>(
        `SELECT id FROM ${this.qt()}`,
      );
      const currentIds = new Set(current.rows.map(r => r.id));
      const newIds = new Set(Object.keys(state.sessions));

      // Delete removed sessions
      const toDelete = current.rows
        .map(r => r.id)
        .filter(id => !newIds.has(id));
      if (toDelete.length > 0) {
        await client.query(
          `DELETE FROM ${this.qt()} WHERE id = ANY($1)`,
          [toDelete],
        );
      }

      // Upsert all sessions
      for (const [id, session] of Object.entries(state.sessions)) {
        await client.query(
          `INSERT INTO ${this.qt()} (id, data, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
          [id, JSON.stringify(session)],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async getSession(id: string): Promise<SerializedSessionInfo | undefined> {
    const result = await this.pool.query<SessionRow>(
      `SELECT data FROM ${this.qt()} WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.data ?? undefined;
  }

  async putSession(id: string, session: SerializedSessionInfo): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.qt()} (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [id, JSON.stringify(session)],
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.qt()} WHERE id = $1`,
      [id],
    );
  }

  async listSessionIds(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM ${this.qt()}`,
    );
    return result.rows.map(r => r.id);
  }

  // ── Internal helpers ───────────────────────────────────────────────

  /** Qualified table name with schema. */
  private qt(): string {
    return `"${this.schemaName}"."${this.tableName}"`;
  }

  /** Create the sessions table if it does not exist. */
  private async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.qt()} (
        id         TEXT PRIMARY KEY,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Index on updated_at for reaper/monitoring queries
    const indexName = `idx_${this.tableName}_updated_at`;
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS "${indexName}"
      ON ${this.qt()} (updated_at)
    `);
  }
}

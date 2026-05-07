/**
 * RedisStateStore.ts — Redis-backed session state store.
 *
 * Stores each session as a separate Redis hash (keyed by `aegis:session:<id>`)
 * and maintains a Redis set of all session IDs at `aegis:sessions`.
 *
 * This design allows per-session reads/writes without serialising the full
 * session map, which matters when the state grows large (hundreds of sessions)
 * or when multiple Aegis nodes share the same Redis instance.
 *
 * Configuration via environment variables (opt-in):
 *   AEGIS_STATE_STORE=redis       — enable Redis backend (default: "file")
 *   AEGIS_REDIS_URL=redis://…     — Redis connection URL (default: redis://localhost:6379)
 *   AEGIS_REDIS_KEY_PREFIX=aegis  — key namespace prefix (default: "aegis")
 *
 * Issue #1948: Horizontal scaling with Redis-backed state.
 */

import type { LifecycleService, ServiceHealth } from '../../container.js';
import type {
  StateStore,
  SerializedSessionInfo,
  SerializedSessionState,
  SerializedPipelineEntry,
  SerializedPipelineState,
} from './state-store.js';

/** Commands available on a Redis MULTI pipeline. */
export interface RedisPipeline {
  hset(key: string, field: string, value: string): this;
  sadd(key: string, ...members: string[]): this;
  srem(key: string, ...members: string[]): this;
  del(key: string | string[]): this;
  exec(): Promise<unknown[]>;
}

/** Minimal Redis client interface — matches ioredis / node-redis surface. */
export interface RedisClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isReady: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  del(key: string | string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  hget(key: string, field: string): Promise<string | undefined>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  ping(): Promise<string>;
  /** Start a MULTI/EXEC pipeline for atomic operations. */
  multi(): RedisPipeline;
  on(event: 'error', handler: (err: Error) => void): this;
  on(event: 'ready', handler: () => void): this;
}

/** Resolved Redis connection configuration. */
export interface RedisStateStoreConfig {
  /** Full Redis URL (redis://host:port or redis://host:port/db). */
  url: string;
  /** Key prefix for all Redis keys (default: "aegis"). */
  keyPrefix: string;
}

const DEFAULT_CONFIG: RedisStateStoreConfig = {
  url: process.env['AEGIS_REDIS_URL'] ?? 'redis://localhost:6379',
  keyPrefix: process.env['AEGIS_REDIS_KEY_PREFIX'] ?? 'aegis',
};

const SESSIONS_SET_KEY = 'sessions';
const PIPELINES_SET_KEY = 'pipelines';

/**
 * Redis-backed implementation of StateStore.
 *
 * Uses dependency injection for the Redis client so tests can provide a mock
 * without needing a real Redis instance.
 */
export class RedisStateStore implements StateStore {
  private readonly client: RedisClient;
  private readonly keyPrefix: string;

  /**
   * @param client  A Redis client instance (ioredis or @redis/client).
   *                The store calls `connect()` during `start()` and `disconnect()` during `stop()`.
   * @param config  Optional configuration overrides.
   */
  constructor(client: RedisClient, config: Partial<RedisStateStoreConfig> = {}) {
    this.client = client;
    this.keyPrefix = config.keyPrefix ?? DEFAULT_CONFIG.keyPrefix;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    await this.client.connect();
  }

  async stop(_signal: AbortSignal): Promise<void> {
    await this.client.disconnect();
  }

  async health(): Promise<ServiceHealth> {
    try {
      const pong = await this.client.ping();
      return { healthy: pong === 'PONG', details: 'redis ping ok' };
    } catch (err) {
      return { healthy: false, details: `redis ping failed: ${(err as Error).message}` };
    }
  }

  // ── StateStore interface ───────────────────────────────────────────

  async load(): Promise<SerializedSessionState> {
    const ids = await this.listSessionIds();
    const sessions: Record<string, SerializedSessionInfo> = Object.create(null) as Record<
      string,
      SerializedSessionInfo
    >;

    for (const id of ids) {
      const session = await this.getSession(id);
      if (session) {
        sessions[id] = session;
      }
    }

    return { sessions };
  }

  async save(state: SerializedSessionState): Promise<void> {
    const currentIds = new Set(await this.listSessionIds());
    const newIds = new Set(Object.keys(state.sessions));

    // Build a single MULTI/EXEC pipeline so all writes and deletes are atomic.
    // If the process crashes mid-save, either all operations commit or none do,
    // keeping the ID set and individual session hashes consistent.
    const pipe = this.client.multi();

    // Upsert all sessions
    for (const [id, session] of Object.entries(state.sessions)) {
      pipe.hset(this.sessionKey(id), 'data', JSON.stringify(session));
      pipe.sadd(this.setKey(), id);
    }

    // Remove sessions that no longer exist in the state
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        pipe.del(this.sessionKey(id));
        pipe.srem(this.setKey(), id);
      }
    }

    await pipe.exec();
  }

  async getSession(id: string): Promise<SerializedSessionInfo | undefined> {
    const key = this.sessionKey(id);
    const raw = await this.client.hget(key, 'data');
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as SerializedSessionInfo;
    } catch {
      return undefined;
    }
  }

  async putSession(id: string, session: SerializedSessionInfo): Promise<void> {
    const key = this.sessionKey(id);
    const pipeline: Promise<unknown>[] = [
      this.client.hset(key, 'data', JSON.stringify(session)),
      this.client.sadd(this.setKey(), id),
    ];
    await Promise.all(pipeline);
  }

  async deleteSession(id: string): Promise<void> {
    const key = this.sessionKey(id);
    await Promise.all([
      this.client.del(key),
      this.client.srem(this.setKey(), id),
    ]);
  }

  async listSessionIds(): Promise<string[]> {
    return this.client.smembers(this.setKey());
  }

  // ── Pipeline StateStore interface ──────────────────────────────────

  async loadPipelines(): Promise<SerializedPipelineState> {
    const ids = await this.listPipelineIds();
    const pipelines: Record<string, SerializedPipelineEntry> = Object.create(null) as Record<
      string,
      SerializedPipelineEntry
    >;

    for (const id of ids) {
      const entry = await this.getPipeline(id);
      if (entry) {
        pipelines[id] = entry;
      }
    }

    return { pipelines };
  }

  async savePipelines(state: SerializedPipelineState): Promise<void> {
    const currentIds = new Set(await this.listPipelineIds());
    const newIds = new Set(Object.keys(state.pipelines));

    // Atomic MULTI/EXEC — same rationale as save().
    const pipe = this.client.multi();

    for (const [id, entry] of Object.entries(state.pipelines)) {
      pipe.hset(this.pipelineKey(id), 'data', JSON.stringify(entry));
      pipe.sadd(this.pipelineSetKey(), id);
    }

    for (const id of currentIds) {
      if (!newIds.has(id)) {
        pipe.del(this.pipelineKey(id));
        pipe.srem(this.pipelineSetKey(), id);
      }
    }

    await pipe.exec();
  }

  async getPipeline(id: string): Promise<SerializedPipelineEntry | undefined> {
    const key = this.pipelineKey(id);
    const raw = await this.client.hget(key, 'data');
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as SerializedPipelineEntry;
    } catch {
      return undefined;
    }
  }

  async putPipeline(id: string, entry: SerializedPipelineEntry): Promise<void> {
    const key = this.pipelineKey(id);
    await Promise.all([
      this.client.hset(key, 'data', JSON.stringify(entry)),
      this.client.sadd(this.pipelineSetKey(), id),
    ]);
  }

  async deletePipeline(id: string): Promise<void> {
    const key = this.pipelineKey(id);
    await Promise.all([
      this.client.del(key),
      this.client.srem(this.pipelineSetKey(), id),
    ]);
  }

  async listPipelineIds(): Promise<string[]> {
    return this.client.smembers(this.pipelineSetKey());
  }

  // ── Key helpers ────────────────────────────────────────────────────

  /** Redis key for a single session hash. */
  private sessionKey(id: string): string {
    return `${this.keyPrefix}:session:${id}`;
  }

  /** Redis key for the sessions ID set. */
  private setKey(): string {
    return `${this.keyPrefix}:${SESSIONS_SET_KEY}`;
  }

  /** Redis key for a single pipeline hash. */
  private pipelineKey(id: string): string {
    return `${this.keyPrefix}:pipeline:${id}`;
  }

  /** Redis key for the pipelines ID set. */
  private pipelineSetKey(): string {
    return `${this.keyPrefix}:${PIPELINES_SET_KEY}`;
  }
}

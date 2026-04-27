/**
 * state-store.ts — Abstract state store interface.
 *
 * Defines the contract for session and pipeline state persistence backends.
 * Three implementations exist:
 *   - JsonFileStore (default): reads/writes state.json + pipelines.json on disk
 *   - PostgresStore (opt-in): backs state with PostgreSQL tables
 *   - RedisStateStore (opt-in): backs state with Redis for horizontal scaling
 *
 * The interface covers load/save of the full session map plus per-session CRUD,
 * and parallel pipeline CRUD. SessionManager and PipelineManager keep their
 * in-memory caches regardless of the backend; the store is the source of truth
 * on disk / in the database / in Redis.
 *
 * Issue #1948: Horizontal scaling with Redis-backed state.
 * Issue #1938: Pipeline state persistence on the same abstraction.
 */

import type { SessionInfo, SessionState } from '../../session.js';
import type { PipelineState, PipelineConfig } from '../../pipeline.js';
import type { LifecycleService, ServiceHealth } from '../../container.js';

/** Serializable representation of a SessionInfo (Set<string> → string[], no Buffers). */
export type SerializedSessionInfo = Omit<SessionInfo, 'activeSubagents'> & {
  activeSubagents?: string[];
};

/** Serialized form of the full session state, suitable for JSON / Redis. */
export interface SerializedSessionState {
  sessions: Record<string, SerializedSessionInfo>;
}

/** Serialized pipeline entry: state + original stage config (for restart). */
export interface SerializedPipelineEntry {
  state: PipelineState;
  config?: PipelineConfig;
}

/** Serialized form of the full pipeline state, suitable for JSON / Redis. */
export interface SerializedPipelineState {
  pipelines: Record<string, SerializedPipelineEntry>;
}

/**
 * Persistent backend for session and pipeline state.
 *
 * Implementations must be concurrency-safe: SessionManager serialises writes
 * at the application layer (save queue / mutex), but the store should handle
 * concurrent readers correctly.
 */
export interface StateStore extends LifecycleService {
  // ── Session methods ──────────────────────────────────────────────────

  /**
   * Load the full session state from the backend.
   * Called once at startup. Returns an empty state if no data exists.
   */
  load(): Promise<SerializedSessionState>;

  /**
   * Persist the full session state atomically.
   * Called after every mutation (create, kill, offset update, etc.).
   */
  save(state: SerializedSessionState): Promise<void>;

  /**
   * Read a single session by ID.
   * Returns undefined if not found.
   */
  getSession(id: string): Promise<SerializedSessionInfo | undefined>;

  /**
   * Persist a single session (create or update).
   */
  putSession(id: string, session: SerializedSessionInfo): Promise<void>;

  /**
   * Delete a single session by ID.
   */
  deleteSession(id: string): Promise<void>;

  /**
   * List all session IDs currently in the store.
   */
  listSessionIds(): Promise<string[]>;

  // ── Pipeline methods ─────────────────────────────────────────────────

  /**
   * Load the full pipeline state from the backend.
   * Called at startup during hydration. Returns empty state if no data exists.
   */
  loadPipelines(): Promise<SerializedPipelineState>;

  /**
   * Persist the full pipeline state atomically.
   * Called after every pipeline mutation.
   */
  savePipelines(state: SerializedPipelineState): Promise<void>;

  /**
   * Read a single pipeline by ID.
   * Returns undefined if not found.
   */
  getPipeline(id: string): Promise<SerializedPipelineEntry | undefined>;

  /**
   * Persist a single pipeline (create or update).
   */
  putPipeline(id: string, entry: SerializedPipelineEntry): Promise<void>;

  /**
   * Delete a single pipeline by ID.
   */
  deletePipeline(id: string): Promise<void>;

  /**
   * List all pipeline IDs currently in the store.
   */
  listPipelineIds(): Promise<string[]>;

  /**
   * Health check for the store backend.
   */
  health(): Promise<ServiceHealth>;
}

/**
 * state-store.ts — Abstract session state store interface.
 *
 * Defines the contract for session state persistence backends.
 * Two implementations exist:
 *   - LocalFileStateStore (default): reads/writes state.json on disk
 *   - RedisStateStore (opt-in): backs session state with Redis for horizontal scaling
 *
 * The interface is deliberately minimal — it covers load/save of the full session
 * map plus per-session CRUD. SessionManager keeps its in-memory cache regardless
 * of the backend; the store is the source of truth on disk / in Redis.
 *
 * Issue #1948: Horizontal scaling with Redis-backed state.
 */

import type { SessionInfo, SessionState } from '../../session.js';
import type { LifecycleService, ServiceHealth } from '../../container.js';

/** Serializable representation of a SessionInfo (Set<string> → string[], no Buffers). */
export type SerializedSessionInfo = Omit<SessionInfo, 'activeSubagents'> & {
  activeSubagents?: string[];
};

/** Serialized form of the full session state, suitable for JSON / Redis. */
export interface SerializedSessionState {
  sessions: Record<string, SerializedSessionInfo>;
}

/**
 * Persistent backend for session state.
 *
 * Implementations must be concurrency-safe: SessionManager serialises writes
 * at the application layer (save queue / mutex), but the store should handle
 * concurrent readers correctly.
 */
export interface StateStore extends LifecycleService {
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

  /**
   * Health check for the store backend.
   */
  health(): Promise<ServiceHealth>;
}

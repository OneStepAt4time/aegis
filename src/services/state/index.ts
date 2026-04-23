/**
 * Re-exports for the state store module.
 *
 * Issue #1948: Horizontal scaling with Redis-backed state.
 */

export type { StateStore, SerializedSessionInfo, SerializedSessionState } from './state-store.js';
export { RedisStateStore } from './RedisStateStore.js';
export type { RedisStateStoreConfig } from './RedisStateStore.js';

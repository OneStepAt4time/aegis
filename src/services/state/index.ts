/**
 * Re-exports for the state store module.
 *
 * Issue #1937: Pluggable SessionStore interface.
 */

export type { StateStore, SerializedSessionInfo, SerializedSessionState, SerializedPipelineEntry, SerializedPipelineState } from './state-store.js';
export { JsonFileStore } from './JsonFileStore.js';
export type { JsonFileStoreConfig } from './JsonFileStore.js';
export { RedisStateStore } from './RedisStateStore.js';
export type { RedisStateStoreConfig } from './RedisStateStore.js';
export { PostgresStore } from './PostgresStore.js';
export type { PostgresStoreConfig } from './PostgresStore.js';
export { createStateStore } from './store-factory.js';

/**
 * Backward-compatibility barrel.
 *
 * `local-storage.ts` historically bundled the ACP local-storage profile and
 * its four stores in a single 1192-line file. The contents have been split
 * into focused modules under `local-storage/` for the gate:arch 500-line
 * ceiling, with this file preserved as a re-export surface so existing
 * imports like `from './local-storage.js'` continue to resolve unchanged.
 */
export {
  DEFAULT_LIST_LIMIT,
  DEFAULT_MAX_EVENTS_PER_SESSION,
  DEFAULT_PERSIST_DEBOUNCE_MS,
  MAX_LIST_LIMIT,
  PRUNABLE_SESSION_STATUSES,
  createEmptyState,
  noopMutationHook,
} from './local-storage/index.js';
export type {
  AcpLocalStorageProfile,
  FileAcpLocalStorageProfileConfig,
  LocalState,
  MutationHook,
} from './local-storage/index.js';
export { MemoryAcpSessionStore } from './local-storage/index.js';
export { MemoryAcpEventStore } from './local-storage/index.js';
export { MemoryAcpActionQueue } from './local-storage/index.js';
export { MemoryAcpPauseInterventionStore } from './local-storage/index.js';
export {
  FileAcpLocalStorageProfile,
  MemoryAcpLocalStorageProfile,
  createFileAcpLocalStorageProfile,
  createMemoryAcpLocalStorageProfile,
} from './local-storage/index.js';

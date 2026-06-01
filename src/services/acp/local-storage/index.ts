/**
 * Barrel module for the ACP local-storage profile and its four bundled
 * stores. All public exports continue to flow through `./local-storage.js`
 * in the parent `services/acp` tree — see `services/acp/index.ts` for the
 * canonical re-exports.
 */

export {
  DEFAULT_LIST_LIMIT,
  DEFAULT_MAX_EVENTS_PER_SESSION,
  DEFAULT_PERSIST_DEBOUNCE_MS,
  MAX_LIST_LIMIT,
  PRUNABLE_SESSION_STATUSES,
  createEmptyState,
  noopMutationHook,
} from './types.js';
export type {
  AcpLocalStorageProfile,
  FileAcpLocalStorageProfileConfig,
  LocalState,
  MutationHook,
} from './types.js';

export { MemoryAcpSessionStore } from './memory-session-store.js';
export { MemoryAcpEventStore } from './memory-event-store.js';
export { MemoryAcpActionQueue } from './memory-action-queue.js';
export { MemoryAcpPauseInterventionStore } from './memory-pause-intervention-store.js';

export {
  FileAcpLocalStorageProfile,
  MemoryAcpLocalStorageProfile,
  createFileAcpLocalStorageProfile,
  createMemoryAcpLocalStorageProfile,
} from './profiles.js';

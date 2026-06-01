import type { AcpSessionRecord, AcpSessionStore } from '../types.js';
import type { AcpEventRecord, AcpEventStore } from '../event-store.js';
import type { AcpActionQueue } from '../action-queue.js';
import type { AcpPauseInterventionStore } from '../pause-intervention.js';

/**
 * Issue #4032: Configuration for file-backed ACP local storage.
 */
export interface FileAcpLocalStorageProfileConfig {
  filePath: string;
  maxEventsPerSession?: number;
  persistDebounceMs?: number;
}

/**
 * Issue #4032: Terminal session statuses whose events can be pruned.
 */
export const PRUNABLE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  'closed',
  'completed',
  'failed',
]);

/**
 * The shared in-memory state shape used by the profile, file persistence,
 * and every Memory* store. Centralised so persistence (de)serialisation and
 * runtime mutation paths stay in sync.
 */
export interface LocalState {
  sessions: AcpSessionRecord[];
  events: AcpEventRecord[];
  actions: import('../action-queue.js').AcpActionRecord[];
  actionOrder: Map<string, number>;
  nextActionOrder: number;
  pauseInterventions: import('../pause-intervention.js').AcpPauseInterventionRecord[];
  lastEventSeqBySession: Map<string, number>;
}

/**
 * Issue #4032: Hook fired after every mutating store operation. Profiles use
 * this to schedule persistence; the noop default keeps pure in-memory users
 * free of side effects.
 */
export type MutationHook = () => Promise<void>;

export const noopMutationHook: MutationHook = async () => {};

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 1_000;

/** Issue #4032: Default max events per session before pruning kicks in. */
export const DEFAULT_MAX_EVENTS_PER_SESSION = 1_000;

/** Issue #4032: Default debounce interval for persist (ms). */
export const DEFAULT_PERSIST_DEBOUNCE_MS = 3_000;

/** Factory for an empty `LocalState`. Lives with the type so the four
 *  Memory* stores and the file-backed profile share one source of truth. */
export function createEmptyState(): LocalState {
  return {
    sessions: [],
    events: [],
    actions: [],
    actionOrder: new Map(),
    nextActionOrder: 0,
    pauseInterventions: [],
    lastEventSeqBySession: new Map(),
  };
}

/**
 * Public surface of an ACP local storage profile: bundles the four stores
 * behind lifecycle and observability hooks. Implementations may be
 * in-memory (testing, ephemeral) or file-backed (durable).
 */
export interface AcpLocalStorageProfile {
  readonly sessionStore: AcpSessionStore;
  readonly eventStore: AcpEventStore;
  readonly actionQueue: AcpActionQueue;
  readonly pauseInterventionStore: AcpPauseInterventionStore;
  start(): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  health(): Promise<import('../../../container.js').ServiceHealth>;
  getPersistError(): Error | null;
}
/** Object-guard used by clone + persistence for safe property access. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../../../logger.js';
import type { ServiceHealth } from '../../../container.js';
import { MemoryAcpSessionStore } from './memory-session-store.js';
import { MemoryAcpEventStore } from './memory-event-store.js';
import { MemoryAcpActionQueue } from './memory-action-queue.js';
import { MemoryAcpPauseInterventionStore } from './memory-pause-intervention-store.js';
import { createEmptyState, DEFAULT_MAX_EVENTS_PER_SESSION, DEFAULT_PERSIST_DEBOUNCE_MS, PRUNABLE_SESSION_STATUSES, noopMutationHook } from './types.js';
import type { AcpLocalStorageProfile, FileAcpLocalStorageProfileConfig, LocalState } from './types.js';
import {
  loadState,
  serializeStateLightweight,
} from './persistence.js';
import type { AcpSessionStore } from '../types.js';
import type { AcpEventStore } from '../event-store.js';
import type { AcpActionQueue } from '../action-queue.js';

export function createMemoryAcpLocalStorageProfile(): AcpLocalStorageProfile {
  return new MemoryAcpLocalStorageProfile();
}

export function createFileAcpLocalStorageProfile(
  config: FileAcpLocalStorageProfileConfig
): AcpLocalStorageProfile {
  return new FileAcpLocalStorageProfile(config);
}

export class MemoryAcpLocalStorageProfile implements AcpLocalStorageProfile {
  private readonly state: LocalState;
  readonly sessionStore: AcpSessionStore;
  readonly eventStore: AcpEventStore;
  readonly actionQueue: AcpActionQueue;
  readonly pauseInterventionStore: MemoryAcpPauseInterventionStore;

  constructor(state: LocalState = createEmptyState(), onMutation = noopMutationHook) {
    this.state = state;
    this.sessionStore = new MemoryAcpSessionStore(this.state, onMutation);
    this.eventStore = new MemoryAcpEventStore(this.state, onMutation);
    this.actionQueue = new MemoryAcpActionQueue(this.state, onMutation);
    this.pauseInterventionStore = new MemoryAcpPauseInterventionStore(this.state, onMutation);
  }

  async start(): Promise<void> {}

  async stop(_signal?: AbortSignal): Promise<void> {}

  async health(): Promise<ServiceHealth> {
    return { healthy: true, details: 'memory ACP local storage profile ok' };
  }

  getPersistError(): Error | null {
    return null;
  }
}

/**
 * File-backed ACP local storage profile.
 *
 * Issue #4032: Hardened against OOM via:
 * - Event compaction: max events per session, prunable terminal sessions
 * - Debounced persistence: coalesces rapid mutations into single disk writes
 * - Incremental event seq tracking: O(1) instead of O(n) per append
 * - Lightweight serialization: skips structuredClone on persist path
 */
export class FileAcpLocalStorageProfile implements AcpLocalStorageProfile {
  private state: LocalState = createEmptyState();
  private started = false;
  private writeChain: Promise<void> = Promise.resolve();
  private persistError: Error | null = null;
  /** Issue #4032: Dirty flag — set when state changes, cleared on persist. */
  private dirty = false;
  /** Issue #4032: Debounce timer for persist. */
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Issue #4032: Resolvers for pending persist promises. */
  private pendingPersistResolvers: Array<() => void> = [];
  private readonly maxEventsPerSession: number;
  private readonly persistDebounceMs: number;
  private readonly memorySessionStore: MemoryAcpSessionStore;
  private readonly memoryEventStore: MemoryAcpEventStore;
  private readonly memoryActionQueue: MemoryAcpActionQueue;
  private readonly memoryPauseInterventionStore: MemoryAcpPauseInterventionStore;

  readonly sessionStore: AcpSessionStore;
  readonly eventStore: AcpEventStore;
  readonly actionQueue: AcpActionQueue;
  readonly pauseInterventionStore: MemoryAcpPauseInterventionStore;

  constructor(private readonly config: FileAcpLocalStorageProfileConfig) {
    this.maxEventsPerSession = config.maxEventsPerSession ?? DEFAULT_MAX_EVENTS_PER_SESSION;
    this.persistDebounceMs = config.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;
    const schedulePersist = (): Promise<void> => this.schedulePersist();
    this.memorySessionStore = new MemoryAcpSessionStore(this.state, schedulePersist);
    this.memoryEventStore = new MemoryAcpEventStore(this.state, schedulePersist, this.maxEventsPerSession);
    this.memoryActionQueue = new MemoryAcpActionQueue(this.state, schedulePersist);
    this.memoryPauseInterventionStore = new MemoryAcpPauseInterventionStore(this.state, schedulePersist);
    this.sessionStore = this.memorySessionStore;
    this.eventStore = this.memoryEventStore;
    this.actionQueue = this.memoryActionQueue;
    this.pauseInterventionStore = this.memoryPauseInterventionStore;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await mkdir(path.dirname(this.config.filePath), { recursive: true });
    this.state = await loadState(this.config.filePath);
    // Issue #4032: Prune events for terminal sessions on startup.
    this.pruneCompletedSessionEvents();
    this.memorySessionStore.replaceState(this.state);
    this.memoryEventStore.replaceState(this.state);
    this.memoryActionQueue.replaceState(this.state);
    this.memoryPauseInterventionStore.replaceState(this.state);
    this.started = true;
    this.dirty = true;
    // Issue #4032: Initial persist after load (which may have pruned events).
    await this.flush();
  }

  async stop(_signal?: AbortSignal): Promise<void> {
    if (!this.started) return;
    // Issue #4032: Flush any pending dirty state before shutdown.
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.flush().catch(() => {});
    // Best-effort final write chain — swallow errors so shutdown completes
    await this.writeChain.catch(() => {});
    this.started = false;
  }

  async health(): Promise<ServiceHealth> {
    if (!this.started) {
      return { healthy: false, details: 'file ACP local storage profile not started' };
    }
    if (this.persistError !== null) {
      return { healthy: false, details: `persist error: ${this.persistError.message}` };
    }
    return { healthy: true, details: 'file ACP local storage profile ok' };
  }

  getPersistError(): Error | null {
    return this.persistError;
  }

  /**
   * Issue #4032: Schedules a debounced persist. The returned promise resolves
   * after the next successful persist cycle.
   */
  private schedulePersist(): Promise<void> {
    this.dirty = true;
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }
    return new Promise<void>(resolve => {
      this.pendingPersistResolvers.push(resolve);
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        void this.persistNow();
      }, this.persistDebounceMs);
    });
  }

  /**
   * Force a flush of any pending writes. Used at start/stop boundaries.
   */
  private async flush(): Promise<void> {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.dirty) {
      await this.persistNow();
    } else {
      this.drainPendingResolvers();
    }
  }

  /**
   * Issue #4032: Coalesced persist — writes the lightweight serialized state
   * to disk via atomic rename and resolves all pending waiters.
   */
  private async persistNow(): Promise<void> {
  private async persistNow(): Promise<void> {
    const serialized = serializeStateLightweight(this.state);
    const tmpPath = `${this.config.filePath}.tmp.${process.pid}`;

    const write = async (): Promise<void> => {
      await writeFile(tmpPath, JSON.stringify(serialized));
      await rename(tmpPath, this.config.filePath);
    };

    // Chain writes so concurrent persists serialize. If a previous write
    // failed, still attempt this write — but ensure failures do not
    // poison subsequent writes (reset writeChain on failure).
    const prevChain = this.writeChain;
    this.writeChain = prevChain.then(write, write)
      .then(() => {
        // Success: clear any previous persist error
        this.persistError = null;
      })
      .catch((err) => {
        // Record the error for health checks but DO NOT re-throw: callers
        // (schedulePersist/flush/stop) expect persist failures to be
        // recorded and not cause unhandled rejections.
        this.persistError = err instanceof Error ? err : new Error(String(err));
        logger.error({
          component: acp-local-storage,
          operation: persistNow,
          attributes: { filePath: this.config.filePath, error: this.persistError.message },
        });
        // Clean up stale tmp file if present; best-effort.
        import(node:fs/promises).then(fs => fs.unlink(tmpPath).catch(() => {})).catch(() => {});
        // Reset chain so next persist() is not chained to a rejected promise
        this.writeChain = Promise.resolve();
      });

    // Await the chain so callers waiting for persist completion are
    // notified, but do not re-throw errors (they are surfaced via
    // getPersistError/health()).
    try {
      await this.writeChain;
      this.dirty = false;
    } finally {
      this.drainPendingResolvers();
    }
  }
  private drainPendingResolvers(): void {
    const resolvers = this.pendingPersistResolvers;
    this.pendingPersistResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  /**
   * Issue #4032: At startup, drop events belonging to terminal sessions so
   * the file does not grow unbounded across restarts.
   */
  private pruneCompletedSessionEvents(): void {
    const prunableSessionIds = new Set<string>();
    for (const session of this.state.sessions) {
      if (PRUNABLE_SESSION_STATUSES.has(session.status)) {
        prunableSessionIds.add(session.id);
      }
    }
    if (prunableSessionIds.size === 0) return;
    const before = this.state.events.length;
    this.state.events = this.state.events.filter(event => !prunableSessionIds.has(event.sessionId));
    const pruned = before - this.state.events.length;
    if (pruned > 0) {
      logger.info({
        component: 'acp-local-storage',
        operation: 'pruneCompletedSessionEvents',
        attributes: { prunedEventCount: pruned, prunedSessionCount: prunableSessionIds.size },
      });
    }
  }
}

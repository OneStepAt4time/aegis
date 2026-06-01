import { logger } from '../../../logger.js';
import type { AcpAppendEventInput, AcpEventRecord, AcpEventStore, AcpListEventsInput } from '../event-store.js';
import { cloneEvent, clonePayload } from './clone.js';
import {
  resolveAfterEventSeq,
  resolveLimit,
  validateAppendInput,
  validateListInput,
} from './validation.js';
import {
  createEmptyState,
  DEFAULT_MAX_EVENTS_PER_SESSION,
  noopMutationHook,
} from './types.js';
import type { LocalState, MutationHook } from './types.js';

/**
 * Issue #4032: Event store with configurable per-session event limit and
 * incremental seq tracking.
 */
export class MemoryAcpEventStore implements AcpEventStore {
  private readonly maxEventsPerSession: number;

  constructor(
    private state: LocalState = createEmptyState(),
    private readonly onMutation: MutationHook = noopMutationHook,
    maxEventsPerSession: number = DEFAULT_MAX_EVENTS_PER_SESSION,
  ) {
    this.maxEventsPerSession = maxEventsPerSession;
  }

  async append(input: AcpAppendEventInput): Promise<AcpEventRecord> {
    const validated = validateAppendInput(input);
    const scopeConflict = this.state.events.find(
      event =>
        event.sessionId === validated.sessionId &&
        (event.tenantId !== validated.tenantId || event.ownerKeyId !== validated.ownerKeyId)
    );
    if (scopeConflict !== undefined) {
      throw new Error('MemoryAcpEventStore: session scope does not match existing event stream');
    }
    // Issue #4032: O(1) seq lookup instead of O(n) scan.
    const eventSeq = this.nextEventSeqIncremental(validated.sessionId);
    const record: AcpEventRecord = {
      ...validated,
      eventSeq,
      eventId: `${validated.tenantId}:${validated.ownerKeyId}:${validated.sessionId}:${eventSeq}`,
      occurredAt: new Date(validated.occurredAt.getTime()),
      ingestedAt: new Date(),
      payload: clonePayload(validated.payload),
    };
    this.state.events.push(cloneEvent(record));
    // Issue #4032: Update seq tracking after append.
    this.state.lastEventSeqBySession.set(validated.sessionId, eventSeq);
    // Issue #4032: Prune oldest events for this session if limit exceeded.
    this.pruneSessionEvents(validated.sessionId);
    await this.onMutation();
    return cloneEvent(record);
  }

  async list(input: AcpListEventsInput): Promise<AcpEventRecord[]> {
    validateListInput(input);
    const afterEventSeq = resolveAfterEventSeq(input.afterEventSeq);
    const limit = resolveLimit(input.limit);
    return this.state.events
      .filter(
        event =>
          event.sessionId === input.sessionId &&
          event.tenantId === input.tenantId &&
          event.ownerKeyId === input.ownerKeyId &&
          event.eventSeq > afterEventSeq
      )
      .sort((left, right) => left.eventSeq - right.eventSeq)
      .slice(0, limit)
      .map(cloneEvent);
  }

  replaceState(state: LocalState): void {
    this.state = state;
  }

  /**
   * Issue #4032: O(1) event seq lookup using incremental tracking map.
   */
  private nextEventSeqIncremental(sessionId: string): number {
    const lastSeq = this.state.lastEventSeqBySession.get(sessionId);
    if (lastSeq !== undefined) return lastSeq + 1;
    // First event for this session — scan once to seed the map (only happens once per session).
    return Math.max(0, ...this.state.events.filter(event => event.sessionId === sessionId).map(event => event.eventSeq)) + 1;
  }

  /**
   * Issue #4032: Prune oldest events for a session when the count exceeds maxEventsPerSession.
   */
  private pruneSessionEvents(sessionId: string): void {
    const sessionEvents = this.state.events.filter(e => e.sessionId === sessionId);
    if (sessionEvents.length <= this.maxEventsPerSession) return;

    const pruneCount = sessionEvents.length - this.maxEventsPerSession;
    // Sort by eventSeq ascending to identify oldest.
    sessionEvents.sort((a, b) => a.eventSeq - b.eventSeq);
    const prunableSeqs = new Set(
      sessionEvents.slice(0, pruneCount).map(e => e.eventSeq)
    );

    const before = this.state.events.length;
    this.state.events = this.state.events.filter(
      e => !(e.sessionId === sessionId && prunableSeqs.has(e.eventSeq))
    );

    if (this.state.events.length < before) {
      logger.info({
        component: 'acp-local-storage',
        operation: 'pruneSessionEvents',
        attributes: { sessionId, prunedCount: before - this.state.events.length, remainingForSession: this.maxEventsPerSession },
      });
    }
  }
}

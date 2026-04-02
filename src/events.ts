/**
 * events.ts — SSE event emitter for session monitoring.
 *
 * Issue #32: Real-time Server-Sent Events for session lifecycle.
 * Subscribers receive events via an EventEmitter pattern.
 * The monitor pushes events; the SSE route consumes them.
 */

import { EventEmitter } from 'node:events';
import { CircularBuffer } from './utils/circular-buffer.js';

export interface SessionSSEEvent {
  event: 'status' | 'message' | 'system' | 'approval' | 'ended' | 'heartbeat' | 'stall' | 'dead' | 'hook' | 'subagent_start' | 'subagent_stop';
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
  /** Issue #87: Unix timestamp (ms) when the event was emitted by Aegis. */
  emittedAt?: number;
  /** Issue #308: Incrementing event ID for Last-Event-ID replay. */
  id?: number;
}

export interface GlobalSSEEvent {
  event: 'session_status_change' | 'session_message' | 'session_approval' | 'session_ended' | 'session_created' | 'session_stall' | 'session_dead' | 'session_subagent_start' | 'session_subagent_stop';
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
  /** Issue #301: Incrementing event ID for Last-Event-ID replay. */
  id?: number;
}

/** Map per-session event types to global event types. */
function toGlobalEvent(event: SessionSSEEvent): GlobalSSEEvent {
  const typeMap: Record<string, GlobalSSEEvent['event']> = {
    status: 'session_status_change',
    message: 'session_message',
    system: 'session_message',
    approval: 'session_approval',
    ended: 'session_ended',
    heartbeat: 'session_status_change',
    stall: 'session_stall',
    dead: 'session_dead',
    subagent_start: 'session_subagent_start',
    subagent_stop: 'session_subagent_stop',
    hook: 'session_message',
  };
  return {
    event: typeMap[event.event] || 'session_status_change',
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    data: event.data,
    id: event.id,
  };
}

/**
 * Per-session event bus. Subscribers (SSE connections) register here.
 * The monitor calls emit() when events happen.
 */
export class SessionEventBus {
  private emitters = new Map<string, EventEmitter>();

  /** #224: Track emitters that are ending so new subscribers get fresh emitters. */
  private readonly endingEmitters = new WeakSet<EventEmitter>();

  /** Global incrementing event ID counter. */
  private nextEventId = 1;

  /** #589: Allocate next event ID with overflow guard. */
  private allocateEventId(): number {
    if (this.nextEventId >= Number.MAX_SAFE_INTEGER) {
      console.warn('[SessionEventBus] Event ID counter approaching MAX_SAFE_INTEGER, resetting to 1');
      this.nextEventId = 1;
    }
    return this.nextEventId++;
  }

  /** Maximum events to buffer per session for Last-Event-ID replay. */
  private static readonly BUFFER_SIZE = 50;

  /** Per-session ring buffer for event replay. */
  private eventBuffers = new Map<string, CircularBuffer<{ id: number; event: SessionSSEEvent }>>();

  /** Global ring buffer for event replay across all sessions (Issue #301). */
  private globalEventBuffer = new CircularBuffer<{ id: number; event: GlobalSSEEvent }>(SessionEventBus.BUFFER_SIZE);

  /** Get or create the emitter for a session. */
  private getEmitter(sessionId: string): EventEmitter {
    let emitter = this.emitters.get(sessionId);
    // #224: If emitter is ending (session ended), create a fresh one
    if (emitter && this.endingEmitters.has(emitter)) {
      this.emitters.delete(sessionId);
      emitter = undefined;
    }
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(50); // Allow many concurrent SSE clients
      this.emitters.set(sessionId, emitter);
    }
    return emitter;
  }

  /** Subscribe to events for a session. Returns unsubscribe function. */
  subscribe(sessionId: string, handler: (event: SessionSSEEvent) => void): () => void {
    const emitter = this.getEmitter(sessionId);
    emitter.on('event', handler);
    return () => {
      emitter.off('event', handler);
      // Clean up emitter if no more listeners and not ending
      if (emitter.listenerCount('event') === 0 && !this.endingEmitters.has(emitter)) {
        this.emitters.delete(sessionId);
      }
    };
  }

  /** Emit an event to all subscribers for a session (and global subscribers). */
  emit(sessionId: string, event: SessionSSEEvent): void {
    // Issue #87: Stamp emittedAt for latency measurement
    event.emittedAt = Date.now();
    // Issue #308: Assign incrementing ID for Last-Event-ID replay
    event.id = this.allocateEventId();
    // Push to ring buffer
    let buffer = this.eventBuffers.get(sessionId);
    if (!buffer) {
      buffer = new CircularBuffer<{ id: number; event: SessionSSEEvent }>(SessionEventBus.BUFFER_SIZE);
      this.eventBuffers.set(sessionId, buffer);
    }
    buffer.push({ id: event.id, event });
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      const imm = setImmediate(() => {
        this.pendingTimers.delete(imm);
        emitter.emit('event', event);
      });
      this.pendingTimers.add(imm);
    }
    // Forward to global subscribers
    if (this.globalEmitter) {
      const globalEvent = toGlobalEvent(event);
      // Issue #301: push to global ring buffer
      this.globalEventBuffer.push({ id: event.id, event: globalEvent });
      const imm = setImmediate(() => {
        this.pendingTimers.delete(imm);
        this.globalEmitter?.emit('event', globalEvent);
      });
      this.pendingTimers.add(imm);
    }
  }

  /** Get events emitted after the given event ID for a session. */
  getEventsSince(sessionId: string, lastEventId: number): SessionSSEEvent[] {
    const buffer = this.eventBuffers.get(sessionId);
    if (!buffer) return [];
    return buffer.toArray().filter(e => e.id > lastEventId).map(e => e.event);
  }

  /** Emit a status change event. */
  emitStatus(sessionId: string, status: string, detail: string): void {
    this.emit(sessionId, {
      event: 'status',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { status, detail },
    });
  }

  /** Emit a message event. */
  emitMessage(sessionId: string, role: string, text: string, contentType?: string, toolMeta?: { tool_name?: string; tool_id?: string }): void {
    this.emit(sessionId, {
      event: 'message',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { role, text, contentType, ...toolMeta },
    });
  }

  /** Issue #89 L33: Emit a system message event (differentiated from user/assistant messages). */
  emitSystem(sessionId: string, text: string, contentType?: string): void {
    this.emit(sessionId, {
      event: 'system',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { role: 'system', text, contentType, isSystem: true },
    });
  }

  /** Emit an approval request event. */
  emitApproval(sessionId: string, prompt: string): void {
    this.emit(sessionId, {
      event: 'approval',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { prompt },
    });
  }

  /** Emit a session ended event. */
  emitEnded(sessionId: string, reason: string): void {
    this.emit(sessionId, {
      event: 'ended',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { reason },
    });
    // #224: Mark emitter as ending so new subscribers don't get silently deleted
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      this.endingEmitters.add(emitter);
    }
    // Clean up after a short delay (let clients receive the event)
    // Capture reference — only delete if it's still the same emitter
    // #357: Also delete the per-session event buffer to prevent unbounded map growth
    // #834: Track the timer so cleanupSession/destroy can cancel it
    const timeout = setTimeout(() => {
      this.pendingTimeouts.delete(timeout);
      if (this.emitters.get(sessionId) === emitter) {
        this.emitters.delete(sessionId);
      }
      this.eventBuffers.delete(sessionId);
    }, 1000);
    this.pendingTimeouts.add(timeout);
  }

  /** Emit a stall event. */
  emitStall(sessionId: string, stallType: string, detail: string): void {
    this.emit(sessionId, {
      event: 'stall',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { stallType, detail },
    });
  }

  /** Emit a dead session event. */
  emitDead(sessionId: string, detail: string): void {
    this.emit(sessionId, {
      event: 'dead',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { reason: detail },
    });
  }

  /** Emit a Claude Code hook event (e.g. Stop, PreToolUse, etc.). */
  emitHook(sessionId: string, hookEvent: string, hookData: Record<string, unknown>): void {
    this.emit(sessionId, {
      event: 'hook',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { hookEvent, ...hookData },
    });
  }

  /** Check if a session has any subscribers. */
  hasSubscribers(sessionId: string): boolean {
    const emitter = this.emitters.get(sessionId);
    return !!emitter && emitter.listenerCount('event') > 0;
  }

  /** Get the number of subscribers for a session. */
  subscriberCount(sessionId: string): number {
    const emitter = this.emitters.get(sessionId);
    return emitter ? emitter.listenerCount('event') : 0;
  }

  // ── Global (all-session) SSE ──────────────────────────────────────

  /** Global emitter for aggregating events across all sessions. */
  private globalEmitter: EventEmitter | null = null;

  /** #689: Pending setImmediate timers for cleanup on destroy. */
  private pendingTimers = new Set<NodeJS.Immediate>();

  /** #834: Pending setTimeout timers for cleanup on destroy/cleanupSession. */
  private pendingTimeouts = new Set<NodeJS.Timeout>();

  /** Subscribe to events from ALL sessions (new and existing). Returns unsubscribe function. */
  subscribeGlobal(handler: (event: GlobalSSEEvent) => void): () => void {
    if (!this.globalEmitter) {
      this.globalEmitter = new EventEmitter();
      this.globalEmitter.setMaxListeners(50);
    }
    this.globalEmitter.on('event', handler);
    return () => {
      this.globalEmitter?.off('event', handler);
      // #689: Nullify globalEmitter when all subscribers leave
      if (this.globalEmitter && this.globalEmitter.listenerCount('event') === 0) {
        this.globalEmitter = null;
      }
    };
  }

  /** Emit a session created event to global subscribers. */
  emitCreated(sessionId: string, name: string, workDir: string): void {
    if (!this.globalEmitter) return;
    const id = this.allocateEventId();
    const globalEvent: GlobalSSEEvent = {
      event: 'session_created',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { name, workDir },
      id,
    };
    // Issue #301: buffer global-only events
    this.globalEventBuffer.push({ id, event: globalEvent });
    this.globalEmitter.emit('event', globalEvent);
  }

  /** Get global events emitted after the given event ID (Issue #301). */
  getGlobalEventsSince(lastEventId: number): Array<{ id: number; event: GlobalSSEEvent }> {
    return this.globalEventBuffer.toArray().filter(e => e.id > lastEventId);
  }

  /** #398: Clean up per-session state (call when session is killed). */
  cleanupSession(sessionId: string): void {
    // #834: Clear pending setTimeout for this session's emitEnded cleanup
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
      this.pendingTimeouts.delete(timeout);
    }
    this.eventBuffers.delete(sessionId);
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.removeAllListeners();
      this.emitters.delete(sessionId);
    }
  }

  /** Clean up all emitters. */
  destroy(): void {
    // #689: Clear pending setImmediate timers before removing listeners
    for (const imm of this.pendingTimers) {
      clearImmediate(imm);
    }
    this.pendingTimers.clear();
    // #834: Clear pending setTimeout timers
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts.clear();
    for (const emitter of this.emitters.values()) {
      emitter.removeAllListeners();
    }
    this.emitters.clear();
    this.eventBuffers.clear();
    this.globalEventBuffer.clear();
    this.globalEmitter?.removeAllListeners();
    this.globalEmitter = null;
  }
}

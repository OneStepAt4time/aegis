/**
 * events.ts — SSE event emitter for session monitoring.
 *
 * Issue #32: Real-time Server-Sent Events for session lifecycle.
 * Subscribers receive events via an EventEmitter pattern.
 * The monitor pushes events; the SSE route consumes them.
 */

import { EventEmitter } from 'node:events';

export interface SessionSSEEvent {
  event: 'status' | 'message' | 'approval' | 'ended' | 'heartbeat' | 'stall' | 'dead' | 'hook' | 'subagent_start' | 'subagent_stop';
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface GlobalSSEEvent {
  event: 'session_status_change' | 'session_message' | 'session_approval' | 'session_ended' | 'session_created' | 'session_stall' | 'session_dead' | 'session_subagent_start' | 'session_subagent_stop';
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Map per-session event types to global event types. */
function toGlobalEvent(event: SessionSSEEvent): GlobalSSEEvent {
  const typeMap: Record<string, GlobalSSEEvent['event']> = {
    status: 'session_status_change',
    message: 'session_message',
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
  };
}

/**
 * Per-session event bus. Subscribers (SSE connections) register here.
 * The monitor calls emit() when events happen.
 */
export class SessionEventBus {
  private emitters = new Map<string, EventEmitter>();

  /** Get or create the emitter for a session. */
  private getEmitter(sessionId: string): EventEmitter {
    let emitter = this.emitters.get(sessionId);
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
      // Clean up emitter if no more listeners
      if (emitter.listenerCount('event') === 0) {
        this.emitters.delete(sessionId);
      }
    };
  }

  /** Emit an event to all subscribers for a session (and global subscribers). */
  emit(sessionId: string, event: SessionSSEEvent): void {
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.emit('event', event);
    }
    // Forward to global subscribers
    if (this.globalEmitter) {
      this.globalEmitter.emit('event', toGlobalEvent(event));
    }
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
  emitMessage(sessionId: string, role: string, text: string, contentType?: string): void {
    this.emit(sessionId, {
      event: 'message',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { role, text, contentType },
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
    // Clean up after a short delay (let clients receive the event)
    setTimeout(() => {
      this.emitters.delete(sessionId);
    }, 1000);
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

  /** Subscribe to events from ALL sessions (new and existing). Returns unsubscribe function. */
  subscribeGlobal(handler: (event: GlobalSSEEvent) => void): () => void {
    if (!this.globalEmitter) {
      this.globalEmitter = new EventEmitter();
      this.globalEmitter.setMaxListeners(50);
    }
    this.globalEmitter.on('event', handler);
    return () => {
      this.globalEmitter?.off('event', handler);
    };
  }

  /** Emit a session created event to global subscribers. */
  emitCreated(sessionId: string, name: string, workDir: string): void {
    if (!this.globalEmitter) return;
    this.globalEmitter.emit('event', {
      event: 'session_created',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { name, workDir },
    });
  }

  /** Clean up all emitters. */
  destroy(): void {
    for (const emitter of this.emitters.values()) {
      emitter.removeAllListeners();
    }
    this.emitters.clear();
    this.globalEmitter?.removeAllListeners();
    this.globalEmitter = null;
  }
}

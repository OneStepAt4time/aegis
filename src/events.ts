/**
 * events.ts — SSE event emitter for session monitoring.
 *
 * Issue #32: Real-time Server-Sent Events for session lifecycle.
 * Subscribers receive events via an EventEmitter pattern.
 * The monitor pushes events; the SSE route consumes them.
 */

import { EventEmitter } from 'node:events';

export interface SessionSSEEvent {
  event: 'status' | 'message' | 'approval' | 'ended' | 'heartbeat';
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
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

  /** Emit an event to all subscribers for a session. */
  emit(sessionId: string, event: SessionSSEEvent): void {
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      emitter.emit('event', event);
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

  /** Clean up all emitters. */
  destroy(): void {
    for (const emitter of this.emitters.values()) {
      emitter.removeAllListeners();
    }
    this.emitters.clear();
  }
}

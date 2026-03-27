/**
 * resilient-eventsource.ts — EventSource wrapper with backoff and circuit breaker.
 *
 * Issue #308: Prevents indefinite reconnection when server is permanently down.
 * Implements exponential backoff, total give-up timeout, and failure counter reset.
 */

const MAX_BACKOFF_MS = 30_000;
const GIVE_UP_MS = 5 * 60 * 1000; // 5 minutes

export interface ResilientCallbacks {
  onReconnecting?: (attempt: number, delay: number) => void;
  onGiveUp?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class ResilientEventSource {
  private eventSource: EventSource | null = null;
  private consecutiveFailures = 0;
  private failStartTime: number | null = null;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private callbacks: ResilientCallbacks;
  private onMessage: (e: MessageEvent) => void;

  constructor(url: string, onMessage: (e: MessageEvent) => void, callbacks: ResilientCallbacks = {}) {
    this.url = url;
    this.onMessage = onMessage;
    this.callbacks = callbacks;
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;

    this.eventSource = new EventSource(this.url);
    this.eventSource.onmessage = this.onMessage;
    this.eventSource.onopen = () => {
      if (this.destroyed) return;
      this.consecutiveFailures = 0;
      this.failStartTime = null;
      this.callbacks.onOpen?.();
    };
    this.eventSource.onerror = () => {
      if (this.destroyed) return;
      this.eventSource?.close();
      this.eventSource = null;

      if (this.failStartTime === null) {
        this.failStartTime = Date.now();
      }

      // Check give-up condition
      if (Date.now() - this.failStartTime >= GIVE_UP_MS) {
        this.callbacks.onGiveUp?.();
        this.callbacks.onClose?.();
        return;
      }

      this.consecutiveFailures++;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, this.consecutiveFailures - 1));
      this.callbacks.onReconnecting?.(this.consecutiveFailures, delay);
      this.callbacks.onClose?.();

      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  close(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.eventSource?.close();
    this.eventSource = null;
  }
}

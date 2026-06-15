/**
 * resilient-eventsource.ts — EventSource wrapper with backoff and circuit breaker.
 *
 * Issue #308: Prevents indefinite reconnection when server is permanently down.
 * Implements exponential backoff, total give-up timeout, and failure counter reset.
 *
 * Issue #4683: Reports open/close/reconnect/giveUp events to perfRecorder
 * for the Endurance Test dashboard-instrumentation surface.
 */

import { perfRecorder } from '../utils/perfRecorder';

const MAX_BACKOFF_MS = 30_000;
const GIVE_UP_MS = 5 * 60 * 1000; // 5 minutes

export interface ResilientCallbacks {
  onReconnecting?: (attempt: number, delay: number) => void;
  onGiveUp?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
}

function endpointFromUrl(url: string): string {
  // Strip protocol + host + query string so we don't leak tokens in
  // the recorder snapshot.
  try {
    const u = new URL(url, window.location.href);
    return u.pathname;
  } catch {
    return url;
  }
}

export class ResilientEventSource {
  private eventSource: EventSource | null = null;
  private consecutiveFailures = 0;
  private failStartTime: number | null = null;
  private destroyed = false;
  private gaveUp = false; // Issue #640: guard against multiple onClose calls
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private endpoint: string;
  private callbacks: ResilientCallbacks;
  private onMessage: (e: MessageEvent) => void;

  constructor(url: string, onMessage: (e: MessageEvent) => void, callbacks: ResilientCallbacks = {}) {
    this.url = url;
    this.endpoint = endpointFromUrl(url);
    this.onMessage = onMessage;
    this.callbacks = callbacks;
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;

    // Clean up previous connection and pending reconnect before creating a new one
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.eventSource = new EventSource(this.url);
    this.eventSource.onmessage = this.onMessage;
    this.eventSource.onopen = () => {
      if (this.destroyed) return;
      this.consecutiveFailures = 0;
      this.failStartTime = null;
      this.gaveUp = false;
      perfRecorder.recordSseOpen(this.endpoint);
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
        if (!this.gaveUp) {
          this.gaveUp = true;
          perfRecorder.recordSseGiveUp(this.endpoint);
          this.callbacks.onGiveUp?.();
          this.callbacks.onClose?.();
        }
        return;
      }

      this.consecutiveFailures++;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, this.consecutiveFailures - 1));
      perfRecorder.recordSseReconnect(this.endpoint, delay);
      this.callbacks.onReconnecting?.(this.consecutiveFailures, delay);
      // Issue #640: Do NOT call onClose during reconnection — only in give-up / explicit close

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

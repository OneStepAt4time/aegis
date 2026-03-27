/**
 * resilient-websocket.ts — WebSocket wrapper with exponential backoff reconnection.
 *
 * Follows the same pattern as ResilientEventSource but for WebSocket connections.
 * Used by the LiveTerminal component for the /v1/sessions/:id/terminal endpoint.
 */

const MAX_BACKOFF_MS = 30_000;
const GIVE_UP_MS = 5 * 60 * 1000; // 5 minutes

export interface ResilientWebSocketCallbacks {
  onMessage: (data: unknown) => void;
  onReconnecting?: (attempt: number, delay: number) => void;
  onGiveUp?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class ResilientWebSocket {
  private ws: WebSocket | null = null;
  private consecutiveFailures = 0;
  private failStartTime: number | null = null;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private callbacks: ResilientWebSocketCallbacks;

  constructor(url: string, callbacks: ResilientWebSocketCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      if (this.destroyed) return;
      this.consecutiveFailures = 0;
      this.failStartTime = null;
      this.callbacks.onOpen?.();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (this.destroyed) return;
      try {
        this.callbacks.onMessage(JSON.parse(event.data as string));
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      if (this.destroyed) return;
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      if (this.destroyed) return;
      // onclose will fire after onerror, which handles reconnection
    };
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    if (this.failStartTime === null) {
      this.failStartTime = Date.now();
    }

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
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  close(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

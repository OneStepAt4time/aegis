/**
 * sse-writer.ts — SSE write helper with back-pressure handling.
 *
 * Issue #302: Check reply.raw.write() return value and disconnect
 * slow clients after consecutive failed writes.
 * Issue #1911: Idle heartbeat + client timeout.
 */

import type { ServerResponse, IncomingMessage } from 'node:http';

export class SSEWriter {
  private consecutiveFailures = 0;
  private isDestroyed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastWrite = Date.now();
  /** Issue #1911: Whether the last send was a keep-alive ping (not real data). */
  private lastPingWasIdle = false;

  /** Drop slow clients after this many consecutive write() calls returning false. */
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  constructor(
    private readonly res: ServerResponse,
    req: IncomingMessage,
    private readonly onCleanup: () => void,
  ) {
    req.on('close', () => this.cleanup());
  }

  /**
   * Write SSE data to the response.
   * Returns true if the write succeeded (or is within failure threshold).
   * Returns false if the connection was destroyed due to back-pressure.
   */
  write(data: string): boolean {
    if (this.isDestroyed) return false;

    try {
      const canContinue = this.res.write(data);
      if (!canContinue) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= SSEWriter.MAX_CONSECUTIVE_FAILURES) {
          this.destroy();
          return false;
        }
      } else {
        this.consecutiveFailures = 0;
        this.lastWrite = Date.now();
        this.lastPingWasIdle = false;
      }
      return true;
    } catch { /* write failed — destroy connection */
      this.destroy();
      return false;
    }
  }

  /**
   * Issue #1911: Start idle-aware heartbeat + client timeout loop.
   *
   * - Checks every `checkIntervalMs` whether data was written recently.
   * - If no data was sent for `idleMs`, emits an SSE comment `:ping\n\n`.
   * - If the client hasn't consumed data for `clientTimeoutMs` total,
   *   the connection is closed (back-pressure or dead consumer).
   *
   * Returns a stop function to cancel the timer.
   */
  startHeartbeat(checkIntervalMs: number, idleMs: number, clientTimeoutMs: number, buildEvent: () => string): () => void {
    this.heartbeatTimer = setInterval(() => {
      if (this.isDestroyed) {
        clearInterval(this.heartbeatTimer!);
        return;
      }
      const now = Date.now();
      const elapsed = now - this.lastWrite;

      // Client hasn't consumed anything for too long — close connection
      if (elapsed >= clientTimeoutMs) {
        this.destroy();
        return;
      }

      // No real data sent for idleMs — send a keep-alive ping
      if (elapsed >= idleMs) {
        if (!this.lastPingWasIdle) {
          // Emit SSE comment as heartbeat — doesn't fire EventSource.onmessage
          this.res.write(':ping\n\n');
          this.lastPingWasIdle = true;
        }
      } else {
        // Normal heartbeat event
        this.write(buildEvent());
      }
    }, checkIntervalMs);

    return () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    };
  }

  /** Issue #1911: Send a final event and end the stream gracefully. */
  sendShutdown(eventData: string): void {
    if (this.isDestroyed) return;
    try {
      this.res.write(eventData);
      this.res.end();
    } catch { /* already closed */ }
    this.destroy();
  }

  private destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try { this.res.end(); } catch { /* already closed */ }
    this.onCleanup();
  }

  private cleanup(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.isDestroyed = true;
    this.onCleanup();
  }
}

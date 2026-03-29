/**
 * sse-writer.ts — SSE write helper with back-pressure handling.
 *
 * Issue #302: Check reply.raw.write() return value and disconnect
 * slow clients after consecutive failed writes.
 */

import type { ServerResponse, IncomingMessage } from 'node:http';

export class SSEWriter {
  private consecutiveFailures = 0;
  private isDestroyed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastWrite = Date.now();

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
      }
      return true;
    } catch { /* write failed — destroy connection */
      this.destroy();
      return false;
    }
  }

  /**
   * Start heartbeat + idle timeout loop.
   * Returns a stop function to cancel the timer.
   */
  startHeartbeat(intervalMs: number, idleTimeoutMs: number, buildEvent: () => string): () => void {
    this.heartbeatTimer = setInterval(() => {
      if (this.isDestroyed) {
        clearInterval(this.heartbeatTimer!);
        return;
      }
      if (Date.now() - this.lastWrite > idleTimeoutMs) {
        this.destroy();
        return;
      }
      this.write(buildEvent());
    }, intervalMs);

    return () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    };
  }

  private destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try { this.res.destroy(); } catch { /* already closed */ }
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

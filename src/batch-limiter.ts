/**
 * batch-limiter.ts — Rate limiter for batch session creation (Issue #583).
 *
 * Enforces:
 * - Per-key cooldown: 1 batch request per configurable interval per API key
 * - Global concurrent session cap: reject batch if total active sessions would exceed limit
 */

export interface BatchLimiterConfig {
  /** Minimum milliseconds between batch requests per API key. Default: 5000 */
  cooldownMs?: number;
  /** Maximum total concurrent sessions across all keys. Default: 200 */
  maxConcurrentSessions?: number;
}

export interface BatchCheckAllowed {
  allowed: true;
}

export interface BatchCheckDenied {
  allowed: false;
  reason: 'cooldown' | 'session_cap';
  /** Human-readable detail */
  detail: string;
}

export type BatchCheckResult = BatchCheckAllowed | BatchCheckDenied;

export class BatchRateLimiter {
  private readonly cooldownMs: number;
  private readonly maxConcurrentSessions: number;
  /** Per-key last batch timestamp. */
  private lastBatch = new Map<string, number>();

  constructor(config?: BatchLimiterConfig) {
    this.cooldownMs = config?.cooldownMs ?? 5000;
    this.maxConcurrentSessions = config?.maxConcurrentSessions ?? 200;
  }

  /**
   * Check whether a batch creation request is allowed.
   * @param keyId - Authenticated API key ID (or 'master' / 'anonymous')
   * @param currentSessionCount - Number of currently active sessions
   * @param requestedCount - Number of sessions this batch would create
   */
  check(keyId: string, currentSessionCount: number, requestedCount: number): BatchCheckResult {
    // Per-key cooldown
    const now = Date.now();
    const lastTime = this.lastBatch.get(keyId);
    if (lastTime !== undefined && now - lastTime < this.cooldownMs) {
      const retryAfter = Math.ceil((this.cooldownMs - (now - lastTime)) / 1000);
      return {
        allowed: false,
        reason: 'cooldown',
        detail: `Batch cooldown active — retry after ${retryAfter}s`,
      };
    }

    // Global concurrent session cap
    if (currentSessionCount + requestedCount > this.maxConcurrentSessions) {
      return {
        allowed: false,
        reason: 'session_cap',
        detail: `Session cap exceeded — ${currentSessionCount} active, ${requestedCount} requested, limit ${this.maxConcurrentSessions}`,
      };
    }

    return { allowed: true };
  }

  /** Record that a batch was accepted for the given key. */
  record(keyId: string): void {
    this.lastBatch.set(keyId, Date.now());
  }

  /** Remove a key's cooldown entry. */
  reset(keyId: string): void {
    this.lastBatch.delete(keyId);
  }

  /** Current configured cooldown in ms. */
  get cooldown(): number {
    return this.cooldownMs;
  }

  /** Current configured max concurrent sessions. */
  get sessionCap(): number {
    return this.maxConcurrentSessions;
  }
}

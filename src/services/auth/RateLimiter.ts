interface IpRateBucket {
  entries: number[];
  start: number;
}

interface AuthFailBucket {
  timestamps: number[];
}

interface KeyRateBucket {
  entries: number[];
  start: number;
}

interface ThrottleEvent {
  timestamp: number;
  ip: string;
  keyId: string | null;
  limit: number;
  current: number;
}

const IP_WINDOW_MS = 60_000;
const IP_LIMIT_NORMAL = 120;
const IP_LIMIT_MASTER = 300;
const MAX_IP_ENTRIES = 10_000;
const MAX_IP_EVENTS_PER_BUCKET = IP_LIMIT_MASTER + 1;
const STALE_IP_BUCKET_MS = 60 * 60 * 1000;

const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX = 5;
const MAX_AUTH_FAIL_IP_ENTRIES = 10_000;
const STALE_AUTH_FAIL_BUCKET_MS = 60 * 60_000;
const STALE_CLEANUP_INTERVAL_MS = 5 * 60_000;

const THROTTLE_HISTORY_MAX = 100;
const THROTTLE_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Route-level auth/IP rate limiter extracted from server.ts.
 * Keeps server wiring simple while preserving existing behavior.
 */
export class RateLimiter {
  private ipRateLimits = new Map<string, IpRateBucket>();
  private authFailLimits = new Map<string, AuthFailBucket>();
  private keyRateLimits = new Map<string, KeyRateBucket>();
  private throttleHistory: ThrottleEvent[] = [];
  private staleCleanupTimer: NodeJS.Timeout;

  constructor() {
    this.staleCleanupTimer = setInterval(() => {
      this.pruneStaleInactiveEntries();
    }, STALE_CLEANUP_INTERVAL_MS);
    this.staleCleanupTimer.unref?.();
  }

  checkIpRateLimit(ip: string, isMaster: boolean): boolean {
    const now = Date.now();
    const cutoff = now - IP_WINDOW_MS;
    const bucket = this.ipRateLimits.get(ip) || { entries: [], start: 0 };

    while (bucket.start < bucket.entries.length && bucket.entries[bucket.start]! < cutoff) {
      bucket.start++;
    }

    if (bucket.start > bucket.entries.length >>> 1) {
      bucket.entries = bucket.entries.slice(bucket.start);
      bucket.start = 0;
    }

    bucket.entries.push(now);
    while (bucket.entries.length - bucket.start > MAX_IP_EVENTS_PER_BUCKET) {
      bucket.start++;
    }
    this.ipRateLimits.set(ip, bucket);

    if (this.ipRateLimits.size > MAX_IP_ENTRIES) {
      let oldestIp = '';
      let oldestTime = Infinity;
      for (const [trackedIp, trackedBucket] of this.ipRateLimits) {
        const lastTs = trackedBucket.entries[trackedBucket.entries.length - 1];
        if (lastTs !== undefined && lastTs < oldestTime) {
          oldestTime = lastTs;
          oldestIp = trackedIp;
        }
      }
      if (oldestIp) this.ipRateLimits.delete(oldestIp);
    }

    const activeCount = bucket.entries.length - bucket.start;
    const limit = isMaster ? IP_LIMIT_MASTER : IP_LIMIT_NORMAL;
    if (activeCount > limit) {
      this.recordThrottle(ip, null, limit, activeCount);
    }
    return activeCount > limit;
  }

  checkAuthFailRateLimit(ip: string): boolean {
    const cutoff = Date.now() - AUTH_FAIL_WINDOW_MS;
    const bucket = this.authFailLimits.get(ip);
    if (!bucket) return false;

    bucket.timestamps = bucket.timestamps.filter((t) => t >= cutoff);
    if (bucket.timestamps.length === 0) {
      this.authFailLimits.delete(ip);
      return false;
    }

    return bucket.timestamps.length >= AUTH_FAIL_MAX;
  }

  recordAuthFailure(ip: string): void {
    const now = Date.now();
    const cutoff = now - AUTH_FAIL_WINDOW_MS;
    const bucket = this.authFailLimits.get(ip) || { timestamps: [] };

    bucket.timestamps = bucket.timestamps.filter((t) => t >= cutoff);
    bucket.timestamps.push(now);
    if (bucket.timestamps.length > AUTH_FAIL_MAX) {
      bucket.timestamps = bucket.timestamps.slice(bucket.timestamps.length - AUTH_FAIL_MAX);
    }
    this.authFailLimits.set(ip, bucket);

    if (this.authFailLimits.size > MAX_AUTH_FAIL_IP_ENTRIES) {
      let oldestIp = '';
      let oldestTime = Infinity;
      for (const [trackedIp, trackedBucket] of this.authFailLimits) {
        const lastTs = trackedBucket.timestamps[trackedBucket.timestamps.length - 1];
        if (lastTs !== undefined && lastTs < oldestTime) {
          oldestTime = lastTs;
          oldestIp = trackedIp;
        }
      }
      if (oldestIp) this.authFailLimits.delete(oldestIp);
    }
  }

  pruneAuthFailLimits(): void {
    const cutoff = Date.now() - AUTH_FAIL_WINDOW_MS;
    for (const [ip, bucket] of this.authFailLimits) {
      bucket.timestamps = bucket.timestamps.filter((t) => t >= cutoff);
      if (bucket.timestamps.length === 0) this.authFailLimits.delete(ip);
    }
  }

  pruneIpRateLimits(): void {
    const cutoff = Date.now() - IP_WINDOW_MS;
    for (const [ip, bucket] of this.ipRateLimits) {
      const last = bucket.entries[bucket.entries.length - 1];
      if (bucket.entries.length - bucket.start === 0 || (last !== undefined && last < cutoff)) {
        this.ipRateLimits.delete(ip);
      }
    }
  }

  dispose(): void {
    clearInterval(this.staleCleanupTimer);
  }

  /** Issue #2248: Record an IP throttle event for history tracking. */
  recordThrottle(ip: string, keyId: string | null, limit: number, current: number): void {
    const event: ThrottleEvent = { timestamp: Date.now(), ip, keyId, limit, current };
    this.throttleHistory.push(event);
    if (this.throttleHistory.length > THROTTLE_HISTORY_MAX) {
      this.throttleHistory = this.throttleHistory.slice(-THROTTLE_HISTORY_MAX);
    }
  }

  /** Issue #2248: Track per-key request rate. Returns true if key is rate-limited. */
  checkKeyRateLimit(keyId: string, limit: number): boolean {
    const now = Date.now();
    const cutoff = now - IP_WINDOW_MS;
    const bucket = this.keyRateLimits.get(keyId) || { entries: [], start: 0 };

    while (bucket.start < bucket.entries.length && bucket.entries[bucket.start]! < cutoff) {
      bucket.start++;
    }
    if (bucket.start > bucket.entries.length >>> 1) {
      bucket.entries = bucket.entries.slice(bucket.start);
      bucket.start = 0;
    }

    bucket.entries.push(now);
    this.keyRateLimits.set(keyId, bucket);

    const activeCount = bucket.entries.length - bucket.start;
    if (activeCount > limit) {
      this.recordThrottle('unknown-ip', keyId, limit, activeCount);
    }
    return activeCount > limit;
  }

  /** Issue #2248: Returns static rate limit configuration. */
  getRateLimitConfig(): { ipNormal: number; ipMaster: number; ipWindowMs: number } {
    return { ipNormal: IP_LIMIT_NORMAL, ipMaster: IP_LIMIT_MASTER, ipWindowMs: IP_WINDOW_MS };
  }

  /** Issue #2248: Returns current IP-level rate limit stats. */
  getIpStats(): { activeIps: number; limitedIps: number } {
    const now = Date.now();
    const cutoff = now - IP_WINDOW_MS;
    let activeIps = 0;
    let limitedIps = 0;
    for (const [, bucket] of this.ipRateLimits) {
      const activeEntries = bucket.entries.slice(bucket.start).filter((t) => t >= cutoff);
      if (activeEntries.length > 0) activeIps++;
      const last = activeEntries[activeEntries.length - 1];
      if (last !== undefined && last >= cutoff && activeEntries.length > IP_LIMIT_NORMAL) {
        limitedIps++;
      }
    }
    return { activeIps, limitedIps };
  }

  /** Issue #2248: Returns per-key usage stats (top 20 by request count). */
  getKeyStats(): Array<{ keyId: string; requestsInWindow: number; limited: boolean }> {
    const now = Date.now();
    const cutoff = now - IP_WINDOW_MS;
    const result: Array<{ keyId: string; requestsInWindow: number; limited: boolean }> = [];
    for (const [keyId, bucket] of this.keyRateLimits) {
      const activeEntries = bucket.entries.slice(bucket.start).filter((t) => t >= cutoff);
      if (activeEntries.length > 0) {
        result.push({ keyId, requestsInWindow: activeEntries.length, limited: activeEntries.length > IP_LIMIT_NORMAL });
      }
    }
    return result.sort((a, b) => b.requestsInWindow - a.requestsInWindow).slice(0, 20);
  }

  /** Issue #2248: Returns throttle events from the last 24 hours. */
  getThrottleHistory(): ThrottleEvent[] {
    const cutoff = Date.now() - THROTTLE_HISTORY_WINDOW_MS;
    return this.throttleHistory.filter((e) => e.timestamp >= cutoff);
  }

  private pruneStaleInactiveEntries(): void {
    const now = Date.now();
    const ipCutoff = now - STALE_IP_BUCKET_MS;
    for (const [ip, bucket] of this.ipRateLimits) {
      const last = bucket.entries[bucket.entries.length - 1];
      if (last === undefined || last < ipCutoff) {
        this.ipRateLimits.delete(ip);
      }
    }

    const authCutoff = now - STALE_AUTH_FAIL_BUCKET_MS;
    for (const [ip, bucket] of this.authFailLimits) {
      const last = bucket.timestamps[bucket.timestamps.length - 1];
      if (last === undefined || last < authCutoff) {
        this.authFailLimits.delete(ip);
      }
    }
  }
}

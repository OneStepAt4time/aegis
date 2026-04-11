interface IpRateBucket {
  entries: number[];
  start: number;
}

interface AuthFailBucket {
  timestamps: number[];
}

const IP_WINDOW_MS = 60_000;
const IP_LIMIT_NORMAL = 120;
const IP_LIMIT_MASTER = 300;
const MAX_IP_ENTRIES = 10_000;

const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX = 5;
const MAX_AUTH_FAIL_IP_ENTRIES = 10_000;

/**
 * Route-level auth/IP rate limiter extracted from server.ts.
 * Keeps server wiring simple while preserving existing behavior.
 */
export class RateLimiter {
  private ipRateLimits = new Map<string, IpRateBucket>();
  private authFailLimits = new Map<string, AuthFailBucket>();

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
    return activeCount > limit;
  }

  checkAuthFailRateLimit(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - AUTH_FAIL_WINDOW_MS;
    const bucket = this.authFailLimits.get(ip) || { timestamps: [] };

    bucket.timestamps = bucket.timestamps.filter((t) => t >= cutoff);
    bucket.timestamps.push(now);
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

    return bucket.timestamps.length > AUTH_FAIL_MAX;
  }

  recordAuthFailure(ip: string): void {
    this.checkAuthFailRateLimit(ip);
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
}

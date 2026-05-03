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
const IP_LIMIT_UNAUTH = 30;
const MAX_IP_ENTRIES = 10_000;
const MAX_IP_EVENTS_PER_BUCKET = IP_LIMIT_MASTER + 1;
const STALE_IP_BUCKET_MS = 60 * 60 * 1000;

const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX = 5;
const MAX_AUTH_FAIL_IP_ENTRIES = 10_000;
const STALE_AUTH_FAIL_BUCKET_MS = 60 * 60 * 1000;
const STALE_CLEANUP_INTERVAL_MS = 5 * 60_000;

/**
 * Route-level auth/IP rate limiter extracted from server.ts.
 *
 * Issue #2456: Authenticated requests use IP+keyId bucket keys so that
 * unauthenticated traffic (health checks, bad tokens) cannot exhaust
 * the rate-limit bucket used by valid API keys on the same IP.
 */
export class RateLimiter {
  private ipRateLimits = new Map<string, IpRateBucket>();
  private authFailLimits = new Map<string, AuthFailBucket>();
  private staleCleanupTimer: NodeJS.Timeout;

  constructor() {
    this.staleCleanupTimer = setInterval(() => {
      this.pruneStaleInactiveEntries();
    }, STALE_CLEANUP_INTERVAL_MS);
    this.staleCleanupTimer.unref?.();
  }

  /**
   * Check per-IP (or per-IP+key) request rate limit.
   * @param ip       Client IP address.
   * @param isMaster Whether the request uses the master key.
   * @param keyId    Optional API key ID. When provided, the bucket key
   *                 becomes `ip:keyId` so authenticated traffic is isolated
   *                 from unauthenticated traffic sharing the same IP.
   */
  checkIpRateLimit(ip: string, isMaster: boolean, keyId?: string): boolean {
    const bucketKey = keyId ? `${ip}:${keyId}` : ip;
    const now = Date.now();
    const cutoff = now - IP_WINDOW_MS;
    const bucket = this.ipRateLimits.get(bucketKey) || { entries: [], start: 0 };

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
    this.ipRateLimits.set(bucketKey, bucket);

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

  /**
   * #2456: Rate limit for unauthenticated requests (no Bearer token).
   * Uses a dedicated `unauth:<ip>` bucket so missing-token traffic
   * cannot exhaust the per-key buckets used by authenticated requests.
   */
  checkIpRateLimitUnauth(ip: string): boolean {
    const bucketKey = `unauth:${ip}`;
    const now = Date.now();
    const cutoff = now - IP_WINDOW_MS;
    const bucket = this.ipRateLimits.get(bucketKey) || { entries: [], start: 0 };

    while (bucket.start < bucket.entries.length && bucket.entries[bucket.start]! < cutoff) {
      bucket.start++;
    }

    if (bucket.start > bucket.entries.length >>> 1) {
      bucket.entries = bucket.entries.slice(bucket.start);
      bucket.start = 0;
    }

    bucket.entries.push(now);
    while (bucket.entries.length - bucket.start > IP_LIMIT_UNAUTH + 1) {
      bucket.start++;
    }
    this.ipRateLimits.set(bucketKey, bucket);

    if (this.ipRateLimits.size > MAX_IP_ENTRIES) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [trackedKey, trackedBucket] of this.ipRateLimits) {
        const lastTs = trackedBucket.entries[trackedBucket.entries.length - 1];
        if (lastTs !== undefined && lastTs < oldestTime) {
          oldestTime = lastTs;
          oldestKey = trackedKey;
        }
      }
      if (oldestKey) this.ipRateLimits.delete(oldestKey);
    }

    const activeCount = bucket.entries.length - bucket.start;
    return activeCount > IP_LIMIT_UNAUTH;
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

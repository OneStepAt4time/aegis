interface IpRateBucket {
  windowStart: number;
  count: number;
}

interface AuthFailBucket {
  timestamps: number[];
}

const IP_WINDOW_MS = 60_000;
const IP_LIMIT_NORMAL = 120;
const IP_LIMIT_MASTER = 300;
const IP_LIMIT_UNAUTH = 30;
const MAX_IP_ENTRIES = 10_000;
const STALE_IP_BUCKET_MS = 60 * 60 * 1000;

const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX = 5;
const MAX_AUTH_FAIL_IP_ENTRIES = 10_000;
const STALE_AUTH_FAIL_BUCKET_MS = 60 * 60 * 1000;
const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Route-level auth/IP rate limiter extracted from server.ts.
 *
 * Issue #2456: Authenticated requests use IP+keyId bucket keys so that
 * unauthenticated traffic (health checks, bad tokens) cannot exhaust
 * the rate-limit bucket used by valid API keys on the same IP.
 *
 * Issue #2455: Uses fixed-window counters (O(1) memory per bucket)
 * instead of per-timestamp arrays to prevent memory growth under
 * sustained load.
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
    let bucket = this.ipRateLimits.get(bucketKey);

    if (!bucket || now - bucket.windowStart >= IP_WINDOW_MS) {
      bucket = { windowStart: now, count: 0 };
      this.ipRateLimits.set(bucketKey, bucket);
    }

    bucket.count++;

    this.evictOldestIpBucket();

    const limit = isMaster ? IP_LIMIT_MASTER : IP_LIMIT_NORMAL;
    return bucket.count > limit;
  }

  /**
   * #2456: Rate limit for unauthenticated requests (no Bearer token).
   * Uses a dedicated `unauth:<ip>` bucket so missing-token traffic
   * cannot exhaust the per-key buckets used by authenticated requests.
   */
  checkIpRateLimitUnauth(ip: string): boolean {
    const bucketKey = `unauth:${ip}`;
    const now = Date.now();
    let bucket = this.ipRateLimits.get(bucketKey);

    if (!bucket || now - bucket.windowStart >= IP_WINDOW_MS) {
      bucket = { windowStart: now, count: 0 };
      this.ipRateLimits.set(bucketKey, bucket);
    }

    bucket.count++;

    this.evictOldestIpBucket();

    return bucket.count > IP_LIMIT_UNAUTH;
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
    const now = Date.now();
    for (const [key, bucket] of this.ipRateLimits) {
      if (now - bucket.windowStart >= IP_WINDOW_MS) {
        this.ipRateLimits.delete(key);
      }
    }
  }

  dispose(): void {
    clearInterval(this.staleCleanupTimer);
  }

  /**
   * When the IP bucket map exceeds MAX_IP_ENTRIES, evict the one
   * with the oldest window start time.
   */
  private evictOldestIpBucket(): void {
    if (this.ipRateLimits.size <= MAX_IP_ENTRIES) return;
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, bucket] of this.ipRateLimits) {
      if (bucket.windowStart < oldestTime) {
        oldestTime = bucket.windowStart;
        oldestKey = key;
      }
    }
    if (oldestKey) this.ipRateLimits.delete(oldestKey);
  }

  private pruneStaleInactiveEntries(): void {
    const now = Date.now();
    const ipCutoff = now - STALE_IP_BUCKET_MS;
    for (const [key, bucket] of this.ipRateLimits) {
      if (bucket.windowStart < ipCutoff) {
        this.ipRateLimits.delete(key);
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

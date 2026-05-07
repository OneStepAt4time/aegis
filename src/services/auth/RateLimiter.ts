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
const MAX_IP_ENTRIES = 5_000;
const MAX_UNAUTH_IP_ENTRIES = 5_000;
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
 *
 * Issue #2493: Bucket keys use a NUL-byte separator (\0) instead of
 * colon to prevent ambiguity if a keyId ever contains a colon.
 *
 * Issue #2494: Authenticated and unauthenticated buckets use separate
 * Maps so they cannot evict each other under contention.
 */

/** NUL-byte separator for compound bucket keys — cannot appear in IPs or keyIds. */
const BUCKET_SEP = '\0';

export class RateLimiter {
  /** Authenticated buckets (ip\0keyId) — evicted independently. */
  private ipRateLimits = new Map<string, IpRateBucket>();
  /** Unauthenticated buckets (unauth\0ip) — evicted independently. */
  private unauthRateLimits = new Map<string, IpRateBucket>();
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
   *                 becomes `ip\0keyId` (NUL separator, Issue #2493) so
   *                 authenticated traffic is isolated from unauthenticated
   *                 traffic sharing the same IP.
   */
  checkIpRateLimit(ip: string, isMaster: boolean, keyId?: string): boolean {
    const bucketKey = keyId ? `${ip}${BUCKET_SEP}${keyId}` : ip;
    const now = Date.now();
    let bucket = this.ipRateLimits.get(bucketKey);

    if (!bucket || now - bucket.windowStart >= IP_WINDOW_MS) {
      bucket = { windowStart: now, count: 0 };
      this.ipRateLimits.set(bucketKey, bucket);
    }

    bucket.count++;

    this.evictOldestBucket(this.ipRateLimits, MAX_IP_ENTRIES);

    const limit = isMaster ? IP_LIMIT_MASTER : IP_LIMIT_NORMAL;
    return bucket.count > limit;
  }

  /**
   * #2456: Rate limit for unauthenticated requests (no Bearer token).
   * Uses a dedicated `unauth\0<ip>` bucket (Issue #2493/2494) in a separate
   * Map so missing-token traffic cannot exhaust the per-key authenticated
   * buckets, and cannot evict them under map-size pressure.
   */
  checkIpRateLimitUnauth(ip: string): boolean {
    const bucketKey = `unauth${BUCKET_SEP}${ip}`;
    const now = Date.now();
    let bucket = this.unauthRateLimits.get(bucketKey);

    if (!bucket || now - bucket.windowStart >= IP_WINDOW_MS) {
      bucket = { windowStart: now, count: 0 };
      this.unauthRateLimits.set(bucketKey, bucket);
    }

    bucket.count++;

    this.evictOldestBucket(this.unauthRateLimits, MAX_UNAUTH_IP_ENTRIES);

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
    for (const [key, bucket] of this.unauthRateLimits) {
      if (now - bucket.windowStart >= IP_WINDOW_MS) {
        this.unauthRateLimits.delete(key);
      }
    }
  }

  dispose(): void {
    clearInterval(this.staleCleanupTimer);
  }

  /**
   * Evict the oldest bucket from a given map when it exceeds the cap.
   * Used for both auth and unauth maps with separate limits (Issue #2494).
   */
  private evictOldestBucket(map: Map<string, IpRateBucket>, maxEntries: number): void {
    if (map.size <= maxEntries) return;
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, bucket] of map) {
      if (bucket.windowStart < oldestTime) {
        oldestTime = bucket.windowStart;
        oldestKey = key;
      }
    }
    if (oldestKey) map.delete(oldestKey);
  }

  private pruneStaleInactiveEntries(): void {
    const now = Date.now();
    const ipCutoff = now - STALE_IP_BUCKET_MS;
    for (const [key, bucket] of this.ipRateLimits) {
      if (bucket.windowStart < ipCutoff) {
        this.ipRateLimits.delete(key);
      }
    }
    for (const [key, bucket] of this.unauthRateLimits) {
      if (bucket.windowStart < ipCutoff) {
        this.unauthRateLimits.delete(key);
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

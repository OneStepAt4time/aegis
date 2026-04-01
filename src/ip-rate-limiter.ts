/**
 * ip-rate-limiter.ts — Per-IP HTTP request rate limiting.
 *
 * #228: Sliding-window rate limiter with circular buffer.
 * #622: O(1) prune via index advancement instead of O(n) shift().
 * #844: Max tracked IPs cap with LRU eviction to prevent memory exhaustion.
 */

interface IpRateBucket {
  entries: number[];
  start: number;
  /** Timestamp of the last rate-limit check for this IP (used for LRU eviction). */
  lastUsedAt: number;
}

export const IP_WINDOW_MS = 60_000;
export const IP_LIMIT_NORMAL = 120;   // per minute for regular keys
export const IP_LIMIT_MASTER = 300;   // per minute for master token
/** #844: Max tracked IPs to prevent unbounded memory growth. */
export const MAX_TRACKED_IPS = 10_000;

export class IpRateLimiter {
  private buckets = new Map<string, IpRateBucket>();

  /** Check and record a request from the given IP. Returns true if rate-limited. */
  check(ip: string, isMaster: boolean): boolean {
    const now = Date.now();
    const cutoff = now - IP_WINDOW_MS;
    const existing = this.buckets.get(ip);
    const bucket = existing || { entries: [], start: 0, lastUsedAt: now };
    bucket.lastUsedAt = now;
    // O(1) prune: advance start index past expired entries
    while (bucket.start < bucket.entries.length && bucket.entries[bucket.start]! < cutoff) {
      bucket.start++;
    }
    // Compact when the leading garbage exceeds 50% of the allocated array
    if (bucket.start > bucket.entries.length >>> 1) {
      bucket.entries = bucket.entries.slice(bucket.start);
      bucket.start = 0;
    }
    bucket.entries.push(now);
    // #844: Enforce max tracked IPs cap to prevent memory exhaustion.
    // Evict the least-recently-used IP when the map exceeds capacity.
    if (!existing && this.buckets.size >= MAX_TRACKED_IPS) {
      let oldestIp: string | null = null;
      let oldestTime = Infinity;
      for (const [trackedIp, trackedBucket] of this.buckets) {
        if (trackedBucket.lastUsedAt < oldestTime) {
          oldestTime = trackedBucket.lastUsedAt;
          oldestIp = trackedIp;
        }
      }
      if (oldestIp !== null) {
        this.buckets.delete(oldestIp);
      }
    }
    this.buckets.set(ip, bucket);
    const activeCount = bucket.entries.length - bucket.start;
    const limit = isMaster ? IP_LIMIT_MASTER : IP_LIMIT_NORMAL;
    return activeCount > limit;
  }

  /** #357: Prune IPs whose timestamp arrays are entirely outside the rate-limit window. */
  prune(): void {
    const cutoff = Date.now() - IP_WINDOW_MS;
    for (const [ip, bucket] of this.buckets) {
      const last = bucket.entries[bucket.entries.length - 1];
      if (bucket.entries.length - bucket.start === 0 || (last !== undefined && last < cutoff)) {
        this.buckets.delete(ip);
      }
    }
  }

  /** Number of currently tracked IPs. */
  get size(): number {
    return this.buckets.size;
  }
}

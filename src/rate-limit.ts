/**
 * rate-limit.ts — Shared IP and auth-failure rate limiting utilities.
 *
 * Extracted from server.ts so both auth middleware and route plugins
 * can access rate-limit state without circular imports.
 */

// #228: Per-IP rate limiting (applies even with master token, with higher limits)
// #622: Circular buffer — O(1) prune via index advancement instead of O(n) shift()
interface IpRateBucket {
  entries: number[];
  start: number;
}
const ipRateLimits = new Map<string, IpRateBucket>();
const IP_WINDOW_MS = 60_000;
const IP_LIMIT_NORMAL = 120;   // per minute for regular keys
const IP_LIMIT_MASTER = 300;   // per minute for master token
const MAX_IP_ENTRIES = 10_000; // #844: Cap tracked IPs to prevent memory exhaustion

export function checkIpRateLimit(ip: string, isMaster: boolean): boolean {
  const now = Date.now();
  const cutoff = now - IP_WINDOW_MS;
  const bucket = ipRateLimits.get(ip) || { entries: [], start: 0 };
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
  ipRateLimits.set(ip, bucket);
  // #844: Evict oldest IPs when map exceeds cap to prevent unbounded memory growth
  if (ipRateLimits.size > MAX_IP_ENTRIES) {
    let oldestIp = '';
    let oldestTime = Infinity;
    for (const [trackedIp, trackedBucket] of ipRateLimits) {
      const lastTs = trackedBucket.entries[trackedBucket.entries.length - 1];
      if (lastTs !== undefined && lastTs < oldestTime) {
        oldestTime = lastTs;
        oldestIp = trackedIp;
      }
    }
    if (oldestIp) ipRateLimits.delete(oldestIp);
  }
  const activeCount = bucket.entries.length - bucket.start;
  const limit = isMaster ? IP_LIMIT_MASTER : IP_LIMIT_NORMAL;
  return activeCount > limit;
}

// #632: Auth failure rate limiting — 5 failed auth attempts per minute per IP.
interface AuthFailBucket {
  timestamps: number[];
}
const authFailLimits = new Map<string, AuthFailBucket>();
const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX = 5;
const MAX_AUTH_FAIL_IP_ENTRIES = 10_000;

export function checkAuthFailRateLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - AUTH_FAIL_WINDOW_MS;
  const bucket = authFailLimits.get(ip) || { timestamps: [] };
  // Prune expired entries
  bucket.timestamps = bucket.timestamps.filter(t => t >= cutoff);
  bucket.timestamps.push(now);
  authFailLimits.set(ip, bucket);
  if (authFailLimits.size > MAX_AUTH_FAIL_IP_ENTRIES) {
    let oldestIp = '';
    let oldestTime = Infinity;
    for (const [trackedIp, trackedBucket] of authFailLimits) {
      const lastTs = trackedBucket.timestamps[trackedBucket.timestamps.length - 1];
      if (lastTs !== undefined && lastTs < oldestTime) {
        oldestTime = lastTs;
        oldestIp = trackedIp;
      }
    }
    if (oldestIp) authFailLimits.delete(oldestIp);
  }
  return bucket.timestamps.length > AUTH_FAIL_MAX;
}

export function recordAuthFailure(ip: string): void {
  checkAuthFailRateLimit(ip);
}

/** #632: Prune stale auth-failure buckets. */
export function pruneAuthFailLimits(): void {
  const cutoff = Date.now() - AUTH_FAIL_WINDOW_MS;
  for (const [ip, bucket] of authFailLimits) {
    bucket.timestamps = bucket.timestamps.filter(t => t >= cutoff);
    if (bucket.timestamps.length === 0) authFailLimits.delete(ip);
  }
}

/** #357: Prune IPs whose timestamp arrays are entirely outside the rate-limit window. */
export function pruneIpRateLimits(): void {
  const cutoff = Date.now() - IP_WINDOW_MS;
  for (const [ip, bucket] of ipRateLimits) {
    // All timestamps are old — remove the entry entirely
    const last = bucket.entries[bucket.entries.length - 1];
    if (bucket.entries.length - bucket.start === 0 || (last !== undefined && last < cutoff)) {
      ipRateLimits.delete(ip);
    }
  }
}

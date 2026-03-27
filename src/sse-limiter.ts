/**
 * sse-limiter.ts — Connection limiter for SSE endpoints (Issue #300).
 *
 * Tracks active SSE connections per-IP and globally.
 * Enforces configurable limits to prevent unbounded resource consumption.
 */

export interface SSELimiterConfig {
  /** Maximum total concurrent SSE connections across all IPs. Default: 100 */
  maxConnections?: number;
  /** Maximum concurrent SSE connections per client IP. Default: 10 */
  maxPerIp?: number;
}

export interface AcquireResult {
  allowed: true;
  connectionId: string;
}

export interface AcquireDeniedResult {
  allowed: false;
  reason: 'per_ip_limit' | 'global_limit';
  /** Current count for the limiting dimension */
  current: number;
  /** Configured limit */
  limit: number;
}

export type AcquireResponse = AcquireResult | AcquireDeniedResult;

interface ConnectionEntry {
  ip: string;
}

export class SSEConnectionLimiter {
  private readonly maxConnections: number;
  private readonly maxPerIp: number;
  private readonly connections = new Map<string, ConnectionEntry>();
  private readonly ipCounts = new Map<string, number>();
  private nextId = 1;

  constructor(config?: SSELimiterConfig) {
    this.maxConnections = config?.maxConnections ?? 100;
    this.maxPerIp = config?.maxPerIp ?? 10;
  }

  /** Current total active connections. */
  get activeCount(): number {
    return this.connections.size;
  }

  /** Active connections for a specific IP. */
  activeCountForIp(ip: string): number {
    return this.ipCounts.get(ip) ?? 0;
  }

  /**
   * Attempt to acquire a connection slot.
   * Check per-IP limit first (more specific), then global limit.
   */
  acquire(ip: string): AcquireResponse {
    const currentPerIp = this.activeCountForIp(ip);
    if (currentPerIp >= this.maxPerIp) {
      return { allowed: false, reason: 'per_ip_limit', current: currentPerIp, limit: this.maxPerIp };
    }

    if (this.connections.size >= this.maxConnections) {
      return { allowed: false, reason: 'global_limit', current: this.connections.size, limit: this.maxConnections };
    }

    const connectionId = `sse-${this.nextId++}`;
    this.connections.set(connectionId, { ip });
    this.ipCounts.set(ip, currentPerIp + 1);
    return { allowed: true, connectionId };
  }

  /**
   * Release a connection slot.
   * Safe to call with unknown or already-released IDs (no-op).
   */
  release(connectionId: string): void {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    this.connections.delete(connectionId);
    const count = this.ipCounts.get(entry.ip);
    if (count !== undefined) {
      if (count <= 1) {
        this.ipCounts.delete(entry.ip);
      } else {
        this.ipCounts.set(entry.ip, count - 1);
      }
    }
  }
}

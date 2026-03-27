import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcquireResponse } from '../sse-limiter.js';
import { SSEConnectionLimiter } from '../sse-limiter.js';

describe('SSEConnectionLimiter (Issue #300)', () => {
  let limiter: SSEConnectionLimiter;

  beforeEach(() => {
    limiter = new SSEConnectionLimiter({ maxConnections: 5, maxPerIp: 2 });
  });

  // ── acquire / release basics ──────────────────────────────

  it('should allow connections under both limits', () => {
    const result = limiter.acquire('192.168.1.1');
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.connectionId).toBe('sse-1');
  });

  it('should track active connection count', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.2');
    expect(limiter.activeCount).toBe(2);
  });

  it('should decrement count on release', () => {
    const r = limiter.acquire('10.0.0.1');
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(limiter.activeCount).toBe(1);
    limiter.release(r.connectionId);
    expect(limiter.activeCount).toBe(0);
  });

  // ── per-IP limit ─────────────────────────────────────────

  it('should reject connections exceeding per-IP limit', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    const result = limiter.acquire('10.0.0.1');
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe('per_ip_limit');
  });

  it('should allow connections from a different IP when per-IP limit hit', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    const result = limiter.acquire('10.0.0.2');
    expect(result.allowed).toBe(true);
  });

  it('should free per-IP slot on release', () => {
    const r1 = limiter.acquire('10.0.0.1');
    expect(r1.allowed).toBe(true);
    if (!r1.allowed) return;
    limiter.acquire('10.0.0.1');
    // at per-IP limit
    expect(limiter.acquire('10.0.0.1').allowed).toBe(false);
    // release one
    limiter.release(r1.connectionId);
    // should now be allowed
    expect(limiter.acquire('10.0.0.1').allowed).toBe(true);
  });

  // ── global limit ─────────────────────────────────────────

  it('should reject connections exceeding global limit', () => {
    // Fill up with different IPs
    for (let i = 0; i < 5; i++) {
      limiter.acquire(`10.0.${i}.1`);
    }
    // 6th connection from any IP should fail
    const result = limiter.acquire('10.0.5.1');
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe('global_limit');
  });

  it('should free global slot on release', () => {
    const connections: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = limiter.acquire(`10.0.${i}.1`);
      expect(r.allowed).toBe(true);
      if (!r.allowed) return;
      connections.push(r.connectionId);
    }
    expect(limiter.acquire('10.0.5.1').allowed).toBe(false);
    limiter.release(connections[0]);
    expect(limiter.acquire('10.0.5.1').allowed).toBe(true);
  });

  // ── per-IP takes priority over global ────────────────────

  it('should report per_ip_limit before global_limit', () => {
    // 2 connections from same IP hits per-IP limit
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    // 3rd from same IP: per-IP reason (not global, even though we still have global headroom)
    const result = limiter.acquire('10.0.0.1');
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe('per_ip_limit');
  });

  // ── release safety ───────────────────────────────────────

  it('should handle release of unknown connectionId gracefully', () => {
    // Should not throw
    limiter.release('nonexistent-id');
    expect(limiter.activeCount).toBe(0);
  });

  it('should handle double-release gracefully', () => {
    const r = limiter.acquire('10.0.0.1');
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    limiter.release(r.connectionId);
    // Second release should not throw or go negative
    limiter.release(r.connectionId);
    expect(limiter.activeCount).toBe(0);
  });

  // ── per-IP count query ───────────────────────────────────

  it('should report per-IP active count', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.2');
    expect(limiter.activeCountForIp('10.0.0.1')).toBe(2);
    expect(limiter.activeCountForIp('10.0.0.2')).toBe(1);
    expect(limiter.activeCountForIp('10.0.0.3')).toBe(0);
  });

  // ── defaults ─────────────────────────────────────────────

  it('should use defaults when no config provided', () => {
    const defaultLimiter = new SSEConnectionLimiter();
    expect(defaultLimiter.activeCount).toBe(0);
    // Should allow at least 10 from one IP
    for (let i = 0; i < 10; i++) {
      expect(defaultLimiter.acquire('10.0.0.1').allowed).toBe(true);
    }
    // 11th should fail (per-IP limit of 10)
    expect(defaultLimiter.acquire('10.0.0.1').allowed).toBe(false);
  });
});

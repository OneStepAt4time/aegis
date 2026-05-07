/**
 * Issue #2536: Verify per-session metrics track message and toolCall counts
 * from JSONL watcher events.
 */

import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../metrics.js';

describe('Issue #2536: per-session message/toolCall counting', () => {
  it('messageReceived increments per-session message count', () => {
    const metrics = new MetricsCollector('/tmp/test-metrics-2536.json');
    metrics.sessionCreated('sess-1');
    metrics.messageReceived('sess-1');
    metrics.messageReceived('sess-1');
    metrics.messageReceived('sess-1');

    const m = metrics.getSessionMetrics('sess-1');
    expect(m).not.toBeNull();
    expect(m!.messages).toBe(3);
    expect(m!.toolCalls).toBe(0);
  });

  it('toolCallReceived increments per-session toolCall count', () => {
    const metrics = new MetricsCollector('/tmp/test-metrics-2536.json');
    metrics.sessionCreated('sess-1');
    metrics.messageReceived('sess-1');
    metrics.messageReceived('sess-1');
    metrics.toolCallReceived('sess-1');
    metrics.toolCallReceived('sess-1');

    const m = metrics.getSessionMetrics('sess-1');
    expect(m).not.toBeNull();
    expect(m!.messages).toBe(2);
    expect(m!.toolCalls).toBe(2);
  });

  it('counts are independent across sessions', () => {
    const metrics = new MetricsCollector('/tmp/test-metrics-2536.json');
    metrics.sessionCreated('s1');
    metrics.sessionCreated('s2');

    metrics.messageReceived('s1');
    metrics.messageReceived('s1');
    metrics.toolCallReceived('s1');

    metrics.messageReceived('s2');
    metrics.toolCallReceived('s2');
    metrics.toolCallReceived('s2');
    metrics.toolCallReceived('s2');

    const m1 = metrics.getSessionMetrics('s1');
    const m2 = metrics.getSessionMetrics('s2');

    expect(m1!.messages).toBe(2);
    expect(m1!.toolCalls).toBe(1);
    expect(m2!.messages).toBe(1);
    expect(m2!.toolCalls).toBe(3);
  });

  it('getSessionMetrics returns null for unknown session', () => {
    const metrics = new MetricsCollector('/tmp/test-metrics-2536.json');
    expect(metrics.getSessionMetrics('nonexistent')).toBeNull();
  });

  it('messageReceived/toolCallReceived are no-ops for unknown session', () => {
    const metrics = new MetricsCollector('/tmp/test-metrics-2536.json');
    // Should not throw
    metrics.messageReceived('unknown');
    metrics.toolCallReceived('unknown');
    expect(metrics.getSessionMetrics('unknown')).toBeNull();
  });

  it('global counters also increment alongside per-session', () => {
    const metrics = new MetricsCollector('/tmp/test-metrics-2536.json');
    metrics.sessionCreated('s1');

    metrics.messageReceived('s1');
    metrics.messageReceived('s1');
    metrics.toolCallReceived('s1');

    const global = metrics.getGlobalMetrics(1);
    // getGlobalMetrics returns avg_messages_per_session
    expect(global.sessions.avg_messages_per_session).toBe(2);
  });
});

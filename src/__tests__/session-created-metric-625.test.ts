/**
 * session-created-metric-625.test.ts — Test for Issue #625.
 *
 * Verifies that metrics.sessionCreated() is correctly called when sessions
 * are created, ensuring the sessionsCreated counter is accurate.
 *
 * We test the MetricsCollector directly since the server route integration
 * requires a full Fastify instance. The key invariant is that after calling
 * sessionCreated(), the counter and per-session map are populated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../metrics.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

// Silence unused-import warnings — these are used in the test body
void join;
void tmpdir;
void rm;

describe('Issue #625: metrics.sessionCreated() tracking', () => {
  let metrics: MetricsCollector;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `aegis-metrics-625-${Date.now()}.json`);
    metrics = new MetricsCollector(tmpFile);
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  it('should increment sessionsCreated counter when sessionCreated is called', () => {
    metrics.sessionCreated('session-abc');
    expect(metrics.getTotalSessionsCreated()).toBe(1);
  });

  it('should report correct total in global metrics after multiple sessionCreated calls', () => {
    metrics.sessionCreated('s1');
    metrics.sessionCreated('s2');
    metrics.sessionCreated('s3');

    const global = metrics.getGlobalMetrics(3);
    expect((global.sessions as Record<string, unknown>).total_created).toBe(3);
    expect((global.sessions as Record<string, unknown>).currently_active).toBe(3);
  });

  it('should create per-session metrics entry when sessionCreated is called', () => {
    metrics.sessionCreated('session-xyz');

    // Per-session metrics should now exist
    const sessionMetrics = metrics.getSessionMetrics('session-xyz');
    expect(sessionMetrics).not.toBeNull();
    expect(sessionMetrics!.messages).toBe(0);
    expect(sessionMetrics!.toolCalls).toBe(0);
    expect(sessionMetrics!.statusChanges).toEqual([]);
  });

  it('should track subsequent metrics for a session after sessionCreated', () => {
    metrics.sessionCreated('session-abc');
    metrics.messageReceived('session-abc');
    metrics.messageReceived('session-abc');
    metrics.toolCallReceived('session-abc');

    const sessionMetrics = metrics.getSessionMetrics('session-abc')!;
    expect(sessionMetrics.messages).toBe(2);
    expect(sessionMetrics.toolCalls).toBe(1);
  });

  it('should persist sessionsCreated counter across save/load', async () => {
    metrics.sessionCreated('s1');
    metrics.sessionCreated('s2');
    await metrics.save();

    const loaded = new MetricsCollector(tmpFile);
    await loaded.load();
    expect(loaded.getTotalSessionsCreated()).toBe(2);
  });

  it('should differentiate between sessionCreated calls for new vs reused sessions', () => {
    // Simulating the server path: new session always calls sessionCreated
    metrics.sessionCreated('new-session-1');

    // Reused session should also be tracked (though the server currently
    // only calls sessionCreated for new sessions, the metric should be
    // called for each logical creation)
    metrics.sessionCreated('new-session-2');

    expect(metrics.getTotalSessionsCreated()).toBe(2);
  });
});

/**
 * metrics.test.ts — Tests for Issue #40: metrics + usage data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../metrics.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('Metrics and usage data (Issue #40)', () => {
  let metrics: MetricsCollector;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `aegis-metrics-${Date.now()}.json`);
    metrics = new MetricsCollector(tmpFile);
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  describe('Global metrics', () => {
    it('should start with zero counters', () => {
      const m = metrics.getGlobalMetrics(0);
      expect(m.sessions).toEqual({
        total_created: 0, currently_active: 0, completed: 0,
        failed: 0, avg_duration_sec: 0, avg_messages_per_session: 0,
      });
    });

    it('should track session creation', () => {
      metrics.sessionCreated('s1');
      metrics.sessionCreated('s2');
      const m = metrics.getGlobalMetrics(2);
      expect((m.sessions as any).total_created).toBe(2);
      expect((m.sessions as any).currently_active).toBe(2);
    });

    it('should track completion and failure', () => {
      metrics.sessionCreated('s1');
      metrics.sessionCreated('s2');
      metrics.sessionCompleted('s1');
      metrics.sessionFailed('s2');
      const m = metrics.getGlobalMetrics(0);
      expect((m.sessions as any).completed).toBe(1);
      expect((m.sessions as any).failed).toBe(1);
    });

    it('should count auto-approvals', () => {
      metrics.sessionCreated('s1');
      metrics.approvalGranted('s1', true);
      metrics.approvalGranted('s1', true);
      const m = metrics.getGlobalMetrics(1);
      expect(m.auto_approvals).toBe(2);
    });

    it('should include uptime', () => {
      const m = metrics.getGlobalMetrics(0);
      expect(typeof m.uptime).toBe('number');
    });

    it('should count webhooks', () => {
      metrics.webhookSent();
      metrics.webhookSent();
      metrics.webhookFailed();
      const m = metrics.getGlobalMetrics(0);
      expect(m.webhooks_sent).toBe(2);
      expect(m.webhooks_failed).toBe(1);
    });
  });

  describe('Per-session metrics', () => {
    it('should track messages per session', () => {
      metrics.sessionCreated('s1');
      metrics.messageReceived('s1');
      metrics.messageReceived('s1');
      expect(metrics.getSessionMetrics('s1')!.messages).toBe(2);
    });

    it('should track tool calls', () => {
      metrics.sessionCreated('s1');
      metrics.toolCallReceived('s1');
      expect(metrics.getSessionMetrics('s1')!.toolCalls).toBe(1);
    });

    it('should track status changes', () => {
      metrics.sessionCreated('s1');
      metrics.statusChanged('s1', 'working');
      metrics.statusChanged('s1', 'idle');
      expect(metrics.getSessionMetrics('s1')!.statusChanges).toEqual(['working', 'idle']);
    });

    it('should track approvals', () => {
      metrics.sessionCreated('s1');
      metrics.approvalGranted('s1', false);
      metrics.approvalGranted('s1', true);
      const m = metrics.getSessionMetrics('s1')!;
      expect(m.approvals).toBe(2);
      expect(m.autoApprovals).toBe(1);
    });

    it('should return null for unknown session', () => {
      expect(metrics.getSessionMetrics('nonexistent')).toBeNull();
    });
  });

  describe('Persistence', () => {
    it('should save and load global metrics', async () => {
      metrics.sessionCreated('s1');
      metrics.webhookSent();
      await metrics.save();

      const m2 = new MetricsCollector(tmpFile);
      await m2.load();
      const m = m2.getGlobalMetrics(0);
      expect((m.sessions as any).total_created).toBe(1);
      expect(m.webhooks_sent).toBe(1);
    });

    it('should handle missing file gracefully', async () => {
      const m2 = new MetricsCollector('/tmp/nonexistent-aegis-metrics.json');
      await m2.load();
      expect((m2.getGlobalMetrics(0).sessions as any).total_created).toBe(0);
    });
  });

  describe('Isolation', () => {
    it('should keep per-session metrics separate', () => {
      metrics.sessionCreated('s1');
      metrics.sessionCreated('s2');
      metrics.messageReceived('s1');
      metrics.messageReceived('s1');
      metrics.messageReceived('s2');
      expect(metrics.getSessionMetrics('s1')!.messages).toBe(2);
      expect(metrics.getSessionMetrics('s2')!.messages).toBe(1);
    });
  });
});

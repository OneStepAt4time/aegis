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

  describe('Prompt delivery metrics', () => {
    it('should track prompt sent and delivered', () => {
      metrics.promptSent(true);
      metrics.promptSent(true);
      const m = metrics.getGlobalMetrics(0);
      expect((m.prompt_delivery as any).sent).toBe(2);
      expect((m.prompt_delivery as any).delivered).toBe(2);
      expect((m.prompt_delivery as any).failed).toBe(0);
    });

    it('should track prompt sent and failed', () => {
      metrics.promptSent(false);
      const m = metrics.getGlobalMetrics(0);
      expect((m.prompt_delivery as any).sent).toBe(1);
      expect((m.prompt_delivery as any).delivered).toBe(0);
      expect((m.prompt_delivery as any).failed).toBe(1);
    });

    it('should calculate success rate', () => {
      metrics.promptSent(true);
      metrics.promptSent(true);
      metrics.promptSent(false);
      const m = metrics.getGlobalMetrics(0);
      expect((m.prompt_delivery as any).success_rate).toBe(67);
    });

    it('should return null success rate when no prompts sent', () => {
      const m = metrics.getGlobalMetrics(0);
      expect((m.prompt_delivery as any).success_rate).toBeNull();
    });

    it('should persist prompt metrics', async () => {
      metrics.promptSent(true);
      metrics.promptSent(false);
      await metrics.save();

      const m2 = new MetricsCollector(tmpFile);
      await m2.load();
      const m = m2.getGlobalMetrics(0);
      expect((m.prompt_delivery as any).sent).toBe(2);
      expect((m.prompt_delivery as any).delivered).toBe(1);
    });
  });

  describe('Latency metrics (Issue #87)', () => {
    it('should return null latency for unknown session', () => {
      expect(metrics.getSessionLatency('nonexistent')).toBeNull();
    });

    it('should record and summarize hook latency', () => {
      metrics.recordHookLatency('s1', 10);
      metrics.recordHookLatency('s1', 20);
      metrics.recordHookLatency('s1', 30);

      const lat = metrics.getSessionLatency('s1')!;
      expect(lat.hook_latency_ms.count).toBe(3);
      expect(lat.hook_latency_ms.min).toBe(10);
      expect(lat.hook_latency_ms.max).toBe(30);
      expect(lat.hook_latency_ms.avg).toBe(20);
    });

    it('should record permission response latency', () => {
      metrics.recordPermissionResponse('s1', 5000);
      metrics.recordPermissionResponse('s1', 10000);

      const lat = metrics.getSessionLatency('s1')!;
      expect(lat.permission_response_ms.count).toBe(2);
      expect(lat.permission_response_ms.min).toBe(5000);
      expect(lat.permission_response_ms.max).toBe(10000);
      expect(lat.permission_response_ms.avg).toBe(7500);
    });

    it('should record state change detection latency', () => {
      metrics.recordStateChangeDetection('s1', 50);
      metrics.recordStateChangeDetection('s1', 150);

      const lat = metrics.getSessionLatency('s1')!;
      expect(lat.state_change_detection_ms.count).toBe(2);
      expect(lat.state_change_detection_ms.avg).toBe(100);
    });

    it('should record channel delivery latency', () => {
      metrics.recordChannelDelivery('s1', 5);
      metrics.recordChannelDelivery('s1', 15);

      const lat = metrics.getSessionLatency('s1')!;
      expect(lat.channel_delivery_ms.count).toBe(2);
      expect(lat.channel_delivery_ms.avg).toBe(10);
    });

    it('should keep latency samples within MAX_LATENCY_SAMPLES', () => {
      for (let i = 0; i < 150; i++) {
        metrics.recordHookLatency('s1', i);
      }

      const lat = metrics.getSessionLatency('s1')!;
      expect(lat.hook_latency_ms.count).toBe(100);
      expect(lat.hook_latency_ms.min).toBe(50); // first 50 evicted
    });

    it('should aggregate latency across sessions in global metrics', () => {
      metrics.recordHookLatency('s1', 10);
      metrics.recordHookLatency('s2', 20);
      metrics.recordPermissionResponse('s1', 5000);

      const m = metrics.getGlobalMetrics(2);
      const latency = m.latency as any;
      expect(latency.hook_latency_ms.count).toBe(2);
      expect(latency.hook_latency_ms.avg).toBe(15);
      expect(latency.permission_response_ms.count).toBe(1);
      expect(latency.permission_response_ms.avg).toBe(5000);
    });

    it('should return empty latency in global metrics when no data', () => {
      const m = metrics.getGlobalMetrics(0);
      const latency = m.latency as any;
      expect(latency.hook_latency_ms.count).toBe(0);
      expect(latency.hook_latency_ms.avg).toBeNull();
      expect(latency.permission_response_ms.count).toBe(0);
    });

    it('should clear session latency', () => {
      metrics.recordHookLatency('s1', 10);
      expect(metrics.getSessionLatency('s1')).not.toBeNull();

      metrics.clearSessionLatency('s1');
      expect(metrics.getSessionLatency('s1')).toBeNull();
    });

    it('should keep latency separate between sessions', () => {
      metrics.recordHookLatency('s1', 10);
      metrics.recordHookLatency('s2', 100);

      expect(metrics.getSessionLatency('s1')!.hook_latency_ms.avg).toBe(10);
      expect(metrics.getSessionLatency('s2')!.hook_latency_ms.avg).toBe(100);
    });
  });
});

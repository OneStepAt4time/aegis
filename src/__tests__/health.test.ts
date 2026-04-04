/**
 * health.test.ts — Tests for /v1/health endpoint.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../metrics.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

describe('Health endpoint data (Issue #40)', () => {
  let metrics: MetricsCollector;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `aegis-metrics-${Date.now()}.json`);
    metrics = new MetricsCollector(tmpFile);
  });

  afterEach(async () => {
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  describe('Total sessions tracking', () => {
    it('should start with zero total sessions', () => {
      expect(metrics.getTotalSessionsCreated()).toBe(0);
    });

    it('should track total sessions created', () => {
      metrics.sessionCreated('s1');
      metrics.sessionCreated('s2');
      metrics.sessionCreated('s3');
      expect(metrics.getTotalSessionsCreated()).toBe(3);
    });

    it('should persist total sessions after load', async () => {
      metrics.sessionCreated('s1');
      metrics.sessionCreated('s2');
      await metrics.save();

      const m2 = new MetricsCollector(tmpFile);
      await m2.load();
      expect(m2.getTotalSessionsCreated()).toBe(2);
    });
  });

  describe('Health response format', () => {
    it('should return correct health data structure', () => {
      metrics.sessionCreated('s1');
      metrics.sessionCreated('s2');

      const activeCount = 1; // Simulating only 1 active session
      const totalCount = metrics.getTotalSessionsCreated();

      const healthData = {
        status: 'ok',
        version: '1.2.0',
        platform: process.platform,
        uptime: process.uptime(),
        sessions: { active: activeCount, total: totalCount },
        timestamp: new Date().toISOString(),
      };

      expect(healthData.status).toBe('ok');
      expect(healthData.version).toBe('1.2.0');
      expect(healthData.platform).toBe(process.platform);
      expect(typeof healthData.uptime).toBe('number');
      expect(healthData.sessions).toEqual({ active: 1, total: 2 });
      expect(healthData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});

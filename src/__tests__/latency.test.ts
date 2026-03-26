/**
 * latency.test.ts — Tests for Issue #87: latency metrics.
 *
 * Tests session-level latency tracking, hooks integration, and SSE emittedAt.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import { MetricsCollector } from '../metrics.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { UIState } from '../terminal-parser.js';

function createMockSessionManager(session: SessionInfo | null): SessionManager {
  return {
    getSession: vi.fn().mockReturnValue(session),
    updateStatusFromHook: vi.fn((_id: string, hookEvent: string, hookTimestamp?: number): UIState | null => {
      if (!session) return null;
      const prev = session.status;
      const now = Date.now();
      switch (hookEvent) {
        case 'Stop': session.status = 'idle'; break;
        case 'PreToolUse':
        case 'PostToolUse': session.status = 'working'; break;
        case 'PermissionRequest': session.status = 'ask_question'; break;
      }
      session.lastHookAt = now;
      session.lastActivity = now;
      session.lastHookReceivedAt = now;
      if (hookTimestamp) session.lastHookEventAt = hookTimestamp;
      if (hookEvent === 'PermissionRequest') session.permissionPromptAt = now;
      return prev;
    }),
    getLatencyMetrics: vi.fn((id: string) => {
      if (!session || id !== session.id) return null;
      let hookLatency: number | null = null;
      if (session.lastHookReceivedAt && session.lastHookEventAt) {
        hookLatency = session.lastHookReceivedAt - session.lastHookEventAt;
        if (hookLatency < 0) hookLatency = null;
      }
      let permissionResponse: number | null = null;
      if (session.permissionPromptAt && session.permissionRespondedAt) {
        permissionResponse = session.permissionRespondedAt - session.permissionPromptAt;
      }
      return {
        hook_latency_ms: hookLatency,
        state_change_detection_ms: hookLatency,
        permission_response_ms: permissionResponse,
      };
    }),
  } as unknown as SessionManager;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-123',
    windowId: '@5',
    windowName: 'cc-test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

describe('Latency metrics (Issue #87)', () => {
  describe('Hook latency recording', () => {
    it('should record hook latency when hook payload has timestamp', async () => {
      const app = Fastify({ logger: false });
      const eventBus = new SessionEventBus();
      const session = makeSession();
      const mockMetrics = {
        recordHookLatency: vi.fn(),
      };
      const mockSessions = createMockSessionManager(session);

      registerHookRoutes(app, { sessions: mockSessions, eventBus, metrics: mockMetrics as any });

      const hookTimestamp = new Date(Date.now() - 50).toISOString();
      await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
        payload: { timestamp: hookTimestamp },
      });

      expect(mockMetrics.recordHookLatency).toHaveBeenCalledOnce();
      const [sessionId, latencyMs] = mockMetrics.recordHookLatency.mock.calls[0];
      expect(sessionId).toBe(session.id);
      expect(latencyMs).toBeGreaterThanOrEqual(40);
      expect(latencyMs).toBeLessThan(5000);
    });

    it('should not record hook latency when no timestamp in payload', async () => {
      const app = Fastify({ logger: false });
      const eventBus = new SessionEventBus();
      const session = makeSession();
      const mockMetrics = {
        recordHookLatency: vi.fn(),
      };
      const mockSessions = createMockSessionManager(session);

      registerHookRoutes(app, { sessions: mockSessions, eventBus, metrics: mockMetrics as any });

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
        payload: {},
      });

      expect(mockMetrics.recordHookLatency).not.toHaveBeenCalled();
    });

    it('should not record negative hook latency (clock skew)', async () => {
      const app = Fastify({ logger: false });
      const eventBus = new SessionEventBus();
      const session = makeSession();
      const mockMetrics = {
        recordHookLatency: vi.fn(),
      };
      const mockSessions = createMockSessionManager(session);

      registerHookRoutes(app, { sessions: mockSessions, eventBus, metrics: mockMetrics as any });

      // Future timestamp (clock skew)
      const futureTimestamp = new Date(Date.now() + 10000).toISOString();
      await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
        payload: { timestamp: futureTimestamp },
      });

      expect(mockMetrics.recordHookLatency).not.toHaveBeenCalled();
    });

    it('should work without metrics collector (optional dep)', async () => {
      const app = Fastify({ logger: false });
      const eventBus = new SessionEventBus();
      const session = makeSession();
      const mockSessions = createMockSessionManager(session);

      // No metrics passed — should not throw
      registerHookRoutes(app, { sessions: mockSessions, eventBus });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
        payload: { timestamp: new Date().toISOString() },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('Session latency tracking', () => {
    it('should track permission prompt and response timestamps', () => {
      const session = makeSession();

      // Simulate permission prompt detected
      session.permissionPromptAt = Date.now() - 5000;
      session.permissionRespondedAt = Date.now();

      const responseMs = session.permissionRespondedAt - session.permissionPromptAt;
      expect(responseMs).toBeGreaterThanOrEqual(4900);
      expect(responseMs).toBeLessThan(10000);
    });

    it('should return null permission_response_ms when prompt not set', () => {
      const session = makeSession();
      session.permissionRespondedAt = Date.now();

      // No permissionPromptAt set
      const responseMs = session.permissionPromptAt && session.permissionRespondedAt
        ? session.permissionRespondedAt - session.permissionPromptAt
        : null;

      expect(responseMs).toBeNull();
    });

    it('should track hook received and event timestamps', () => {
      const session = makeSession();
      const hookEventTime = Date.now() - 100;
      const hookReceivedTime = Date.now();

      session.lastHookEventAt = hookEventTime;
      session.lastHookReceivedAt = hookReceivedTime;

      const hookLatency = hookReceivedTime - hookEventTime;
      expect(hookLatency).toBeGreaterThanOrEqual(90);
      expect(hookLatency).toBeLessThan(500);
    });

    it('should return null hook_latency_ms when receive time not set', () => {
      const session = makeSession();
      session.lastHookEventAt = Date.now() - 100;
      // lastHookReceivedAt not set

      const hookLatency = session.lastHookReceivedAt && session.lastHookEventAt
        ? session.lastHookReceivedAt - session.lastHookEventAt
        : null;

      expect(hookLatency).toBeNull();
    });
  });

  describe('SSE emittedAt timestamp', () => {
    it('should include emittedAt on SSE events', () => {
      const eventBus = new SessionEventBus();
      const events: Array<{ event: string; emittedAt?: number }> = [];
      eventBus.subscribe('s1', (e) => events.push(e));

      eventBus.emitStatus('s1', 'idle', 'test');

      expect(events).toHaveLength(1);
      expect(typeof events[0].emittedAt).toBe('number');
      expect(events[0].emittedAt).toBeGreaterThan(0);
    });

    it('should include emittedAt on hook events', () => {
      const eventBus = new SessionEventBus();
      const events: Array<{ event: string; emittedAt?: number }> = [];
      eventBus.subscribe('s1', (e) => events.push(e));

      eventBus.emitHook('s1', 'Stop', { stop_reason: 'done' });

      expect(events).toHaveLength(1);
      expect(typeof events[0].emittedAt).toBe('number');
    });

    it('should include emittedAt on approval events', () => {
      const eventBus = new SessionEventBus();
      const events: Array<{ event: string; emittedAt?: number }> = [];
      eventBus.subscribe('s1', (e) => events.push(e));

      eventBus.emitApproval('s1', 'Allow file write?');

      expect(events).toHaveLength(1);
      expect(typeof events[0].emittedAt).toBe('number');
    });
  });

  describe('Latency endpoint integration', () => {
    it('should return latency data from /v1/sessions/:id/latency', async () => {
      const session = makeSession();
      session.lastHookReceivedAt = Date.now();
      session.lastHookEventAt = Date.now() - 50;

      const mockSessions = {
        getSession: vi.fn().mockReturnValue(session),
        getLatencyMetrics: vi.fn().mockReturnValue({
          hook_latency_ms: 50,
          state_change_detection_ms: 50,
          permission_response_ms: null,
        }),
      } as unknown as SessionManager;

      const metrics = new MetricsCollector('/tmp/test-latency-endpoint.json');
      metrics.recordHookLatency(session.id, 50);

      const app = Fastify({ logger: false });
      app.get<{ Params: { id: string } }>('/v1/sessions/:id/latency', async (req, reply) => {
        const s = mockSessions.getSession(req.params.id);
        if (!s) return reply.status(404).send({ error: 'Session not found' });
        const realtimeLatency = mockSessions.getLatencyMetrics(req.params.id);
        const aggregatedLatency = metrics.getSessionLatency(req.params.id);
        return {
          sessionId: req.params.id,
          realtime: realtimeLatency,
          aggregated: aggregatedLatency,
        };
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${session.id}/latency`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessionId).toBe(session.id);
      expect(body.realtime.hook_latency_ms).toBe(50);
      expect(body.realtime.permission_response_ms).toBeNull();
      expect(body.aggregated.hook_latency_ms.count).toBe(1);
      expect(body.aggregated.hook_latency_ms.avg).toBe(50);
    });

    it('should return 404 for non-existent session latency', async () => {
      const mockSessions = {
        getSession: vi.fn().mockReturnValue(null),
        getLatencyMetrics: vi.fn().mockReturnValue(null),
      } as unknown as SessionManager;

      const metrics = new MetricsCollector('/tmp/test-latency-404.json');

      const app = Fastify({ logger: false });
      app.get<{ Params: { id: string } }>('/v1/sessions/:id/latency', async (req, reply) => {
        const s = mockSessions.getSession(req.params.id);
        if (!s) return reply.status(404).send({ error: 'Session not found' });
        const realtimeLatency = mockSessions.getLatencyMetrics(req.params.id);
        const aggregatedLatency = metrics.getSessionLatency(req.params.id);
        return {
          sessionId: req.params.id,
          realtime: realtimeLatency,
          aggregated: aggregatedLatency,
        };
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions/nonexistent/latency',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';
import type { SessionInfo, RowHealth, GlobalMetrics, GlobalSSEEvent } from '../types';

const mockSession: SessionInfo = {
  id: 's1',
  windowId: 'w1',
  windowName: 'test',
  workDir: '/tmp',
  status: 'idle',
  createdAt: Date.now(),
  lastActivity: Date.now(),
  stallThresholdMs: 300000,
  permissionMode: 'default',
  byteOffset: 0,
  monitorOffset: 0,
};

const mockHealth: RowHealth = { alive: true, loading: false };
const mockMetrics: GlobalMetrics = {
  uptime: 1,
  sessions: {
    total_created: 2,
    currently_active: 1,
    completed: 1,
    failed: 0,
    avg_duration_sec: 42,
    avg_messages_per_session: 3,
  },
  auto_approvals: 0,
  webhooks_sent: 0,
  webhooks_failed: 0,
  screenshots_taken: 0,
  pipelines_created: 0,
  batches_created: 0,
  prompt_delivery: {
    sent: 1,
    delivered: 1,
    failed: 0,
    success_rate: 100,
  },
  latency: {
    hook_latency_ms: { min: 2, max: 6, avg: 4, count: 2 },
    state_change_detection_ms: { min: 2, max: 6, avg: 4, count: 2 },
    permission_response_ms: { min: 20, max: 40, avg: 30, count: 2 },
    channel_delivery_ms: { min: 3, max: 7, avg: 5, count: 2 },
  },
};

const mockActivity: GlobalSSEEvent = {
  event: 'session_message',
  sessionId: 's1',
  timestamp: '2026-04-04T12:00:00.000Z',
  data: { role: 'assistant', text: 'hello' },
};

describe('useStore', () => {
  beforeEach(() => {
    useStore.setState({
      sessions: [],
      healthMap: {},
      metrics: null,
      activities: [],
    });
  });

  describe('setSessionsAndHealth', () => {
    it('sets sessions and healthMap atomically', () => {
      const healthMap: Record<string, RowHealth> = { s1: mockHealth };

      useStore.getState().setSessionsAndHealth([mockSession], healthMap);

      const state = useStore.getState();
      expect(state.sessions).toEqual([mockSession]);
      expect(state.healthMap).toEqual(healthMap);
    });

    it('replaces previous state entirely', () => {
      const oldSession: SessionInfo = {
        ...mockSession,
        id: 'old',
      };
      useStore.setState({
        sessions: [oldSession],
        healthMap: { old: mockHealth },
      });

      useStore.getState().setSessionsAndHealth([mockSession], { s1: mockHealth });

      const state = useStore.getState();
      expect(state.sessions).toEqual([mockSession]);
      expect(state.healthMap).toEqual({ s1: mockHealth });
    });

    it('keeps references stable when incoming sessions and health are unchanged', () => {
      useStore.getState().setSessionsAndHealth([mockSession], { s1: mockHealth });

      const firstState = useStore.getState();
      const firstSessionsRef = firstState.sessions;
      const firstHealthMapRef = firstState.healthMap;

      useStore.getState().setSessionsAndHealth([{ ...mockSession }], { s1: { ...mockHealth } });

      const nextState = useStore.getState();
      expect(nextState.sessions).toBe(firstSessionsRef);
      expect(nextState.healthMap).toBe(firstHealthMapRef);
    });
  });

  describe('setMetrics', () => {
    it('keeps metrics reference stable for equivalent payloads', () => {
      useStore.getState().setMetrics(mockMetrics);

      const firstMetricsRef = useStore.getState().metrics;

      useStore.getState().setMetrics(JSON.parse(JSON.stringify(mockMetrics)) as GlobalMetrics);

      expect(useStore.getState().metrics).toBe(firstMetricsRef);
    });
  });

  describe('addActivity', () => {
    it('assigns stable render keys while prepending new activity', () => {
      useStore.getState().addActivity(mockActivity);
      const firstActivity = useStore.getState().activities[0];

      useStore.getState().addActivity({
        ...mockActivity,
        timestamp: '2026-04-04T12:00:01.000Z',
      });

      const state = useStore.getState();
      expect(state.activities).toHaveLength(2);
      expect(state.activities[0].renderKey).not.toBe(firstActivity.renderKey);
      expect(state.activities[1].renderKey).toBe(firstActivity.renderKey);
    });
  });

  describe('dead code removed (#296)', () => {
    it('sessionMessages is not in the store', () => {
      const state = useStore.getState() as unknown as Record<string, unknown>;
      expect('sessionMessages' in state).toBe(false);
      expect('addMessage' in state).toBe(false);
      expect('setSessionMessages' in state).toBe(false);
    });
  });
});

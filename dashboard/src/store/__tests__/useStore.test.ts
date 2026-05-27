/**
 * store/__tests__/useStore.test.ts — Tests for the global Zustand store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useStore } from '../useStore';
import type { SessionInfo, GlobalMetrics, GlobalSSEEvent, RowHealth } from '../../types';

function makeGlobalMetrics(overrides: Partial<GlobalMetrics> = {}): GlobalMetrics {
  return {
    uptime: 100,
    sessions: {
      total_created: overrides.uptime ?? 0,
      currently_active: 0,
      completed: 0,
      failed: 0,
      avg_duration_sec: 0,
      avg_messages_per_session: 0,
      infra_failed: 0,
      killed: 0,
      ...overrides.sessions,
    },
    auto_approvals: 0,
    webhooks_sent: 0,
    webhooks_failed: 0,
    screenshots_taken: 0,
    ...overrides,
  } as GlobalMetrics;
}

// Helper to create a minimal SessionInfo
function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1',
    displayName: 'Test Session',
    workDir: '/tmp',
    claudeSessionId: 'cc-1',
    jsonlPath: '/tmp/s1.jsonl',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'running',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 60000,
    permissionMode: 'default',
    autoApprove: false,
    settingsPatched: false,
    ...overrides,
  } as SessionInfo;
}

beforeEach(() => {
  // Reset to initial state
  useStore.setState({
    token: null,
    sessions: [],
    healthMap: {},
    metrics: null,
    sseConnected: false,
    sseError: null,
    activities: [],
    activityFilterSession: null,
    activityFilterType: null,
  });
});

describe('useStore', () => {
  describe('auth', () => {
    it('sets and clears token', () => {
      act(() => {
        useStore.getState().setToken('my-token');
      });
      expect(useStore.getState().token).toBe('my-token');

      act(() => {
        useStore.getState().clearToken();
      });
      expect(useStore.getState().token).toBeNull();
    });
  });

  describe('sessions', () => {
    it('sets sessions', () => {
      const sessions = [makeSession()];
      act(() => {
        useStore.getState().setSessions(sessions);
      });
      expect(useStore.getState().sessions).toEqual(sessions);
    });

    it('skips state update when sessions are equal', () => {
      const sessions = [makeSession()];
      act(() => {
        useStore.getState().setSessions(sessions);
      });

      const before = useStore.getState();
      act(() => {
        useStore.getState().setSessions(sessions);
      });

      expect(useStore.getState()).toBe(before);
    });

    it('detects changed session fields', () => {
      act(() => {
        useStore.getState().setSessions([makeSession()]);
      });

      act(() => {
        useStore.getState().setSessions([makeSession({ status: 'completed' })]);
      });

      expect(useStore.getState().sessions[0].status).toBe('completed');
    });

    it('detects length change', () => {
      act(() => {
        useStore.getState().setSessions([makeSession()]);
      });

      act(() => {
        useStore.getState().setSessions([makeSession(), makeSession({ id: 's2' })]);
      });

      expect(useStore.getState().sessions).toHaveLength(2);
    });
  });

  describe('healthMap', () => {
    it('sets health map', () => {
      const health: Record<string, RowHealth> = { s1: { alive: true, loading: false } };
      act(() => {
        useStore.getState().setHealth(health);
      });
      expect(useStore.getState().healthMap).toEqual(health);
    });

    it('skips update when health maps are equal', () => {
      const health: Record<string, RowHealth> = { s1: { alive: true, loading: false } };
      act(() => {
        useStore.getState().setHealth(health);
      });

      const before = useStore.getState();
      act(() => {
        useStore.getState().setHealth(health);
      });

      expect(useStore.getState()).toBe(before);
    });

    it('setSessionsAndHealth updates both atomically', () => {
      const sessions = [makeSession()];
      const health: Record<string, RowHealth> = { s1: { alive: true, loading: false } };

      act(() => {
        useStore.getState().setSessionsAndHealth(sessions, health);
      });

      expect(useStore.getState().sessions).toEqual(sessions);
      expect(useStore.getState().healthMap).toEqual(health);
    });

    it('setSessionsAndHealth skips when both are unchanged', () => {
      const sessions = [makeSession()];
      const health: Record<string, RowHealth> = { s1: { alive: true, loading: false } };

      act(() => {
        useStore.getState().setSessionsAndHealth(sessions, health);
      });

      const before = useStore.getState();
      act(() => {
        useStore.getState().setSessionsAndHealth(sessions, health);
      });

      expect(useStore.getState()).toBe(before);
    });
  });

  describe('metrics', () => {
    it('sets metrics', () => {
      const metrics = makeGlobalMetrics();
      act(() => {
        useStore.getState().setMetrics(metrics);
      });
      expect(useStore.getState().metrics).toEqual(metrics);
    });

    it('skips update when metrics are equal', () => {
      const metrics = makeGlobalMetrics();
      act(() => {
        useStore.getState().setMetrics(metrics);
      });

      const before = useStore.getState();
      act(() => {
        useStore.getState().setMetrics(metrics);
      });

      expect(useStore.getState()).toBe(before);
    });

    it('sets metrics from null to value', () => {
      const metrics = makeGlobalMetrics();
      act(() => {
        useStore.getState().setMetrics(metrics);
      });
      expect(useStore.getState().metrics).toEqual(metrics);
    });

    it('detects metrics change via JSON comparison', () => {
      act(() => {
        useStore.getState().setMetrics(makeGlobalMetrics());
      });

      act(() => {
        useStore.getState().setMetrics(makeGlobalMetrics({ uptime: 200, sessions: { total_created: 2, currently_active: 0, completed: 0, failed: 0, avg_duration_sec: 0, avg_messages_per_session: 0, infra_failed: 0, killed: 0 } }));
      });

      expect((useStore.getState().metrics as any).uptime).toBe(200);
    });
  });

  describe('SSE', () => {
    it('sets SSE connected state', () => {
      act(() => {
        useStore.getState().setSseConnected(true);
      });
      expect(useStore.getState().sseConnected).toBe(true);
    });

    it('sets SSE error', () => {
      act(() => {
        useStore.getState().setSseError('Connection lost');
      });
      expect(useStore.getState().sseError).toBe('Connection lost');
    });

    it('clears SSE error', () => {
      act(() => {
        useStore.getState().setSseError('error');
        useStore.getState().setSseError(null);
      });
      expect(useStore.getState().sseError).toBeNull();
    });
  });

  describe('activity stream', () => {
    const makeEvent = (sessionId = 's1'): GlobalSSEEvent => ({
      sessionId,
      timestamp: new Date().toISOString(),
      event: 'session_status_change',
      data: {},
    });

    it('adds activity with render key', () => {
      act(() => {
        useStore.getState().addActivity(makeEvent());
      });

      const activities = useStore.getState().activities;
      expect(activities).toHaveLength(1);
      expect(activities[0].renderKey).toBeDefined();
      expect(activities[0].sessionId).toBe('s1');
    });

    it('prepends new activities', () => {
      act(() => {
        useStore.getState().addActivity(makeEvent('s1'));
        useStore.getState().addActivity(makeEvent('s2'));
      });

      expect(useStore.getState().activities[0].sessionId).toBe('s2');
    });

    it('caps activities at 200', () => {
      for (let i = 0; i < 210; i++) {
        act(() => {
          useStore.getState().addActivity(makeEvent(`s-${i}`));
        });
      }

      expect(useStore.getState().activities).toHaveLength(200);
    });

    it('clears all activities', () => {
      act(() => {
        useStore.getState().addActivity(makeEvent());
        useStore.getState().addActivity(makeEvent());
      });

      act(() => {
        useStore.getState().clearActivities();
      });

      expect(useStore.getState().activities).toEqual([]);
    });

    it('sets activity filter by session', () => {
      act(() => {
        useStore.getState().setActivityFilterSession('s1');
      });
      expect(useStore.getState().activityFilterSession).toBe('s1');
    });

    it('sets activity filter by type', () => {
      act(() => {
        useStore.getState().setActivityFilterType('session_approval');
      });
      expect(useStore.getState().activityFilterType).toBe('session_approval');
    });

    it('clears activity filter', () => {
      act(() => {
        useStore.getState().setActivityFilterSession('s1');
        useStore.getState().setActivityFilterSession(null);
      });
      expect(useStore.getState().activityFilterSession).toBeNull();
    });
  });
});

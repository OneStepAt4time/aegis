import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';
import type { SessionInfo, RowHealth } from '../types';

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

describe('useStore', () => {
  beforeEach(() => {
    useStore.setState({
      sessions: [],
      healthMap: {},
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
  });
});

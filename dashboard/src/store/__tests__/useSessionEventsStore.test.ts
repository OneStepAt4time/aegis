/**
 * store/__tests__/useSessionEventsStore.test.ts — Tests for SSE event state store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useSessionEventsStore,
  selectSession,
  selectMessageCount,
  selectUserMessageCount,
  selectAssistantMessageCount,
  selectToolCallCount,
  selectThinkingCount,
} from '../useSessionEventsStore';
import type { ParsedEntry, UIState, SessionMetrics } from '../../types';

// Reset store between tests
beforeEach(() => {
  useSessionEventsStore.setState({ sessions: {} });
});

describe('useSessionEventsStore', () => {
  it('initializes with empty sessions map', () => {
    expect(useSessionEventsStore.getState().sessions).toEqual({});
  });

  describe('ensureSession', () => {
    it('creates a new session slot with default state', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      const session = useSessionEventsStore.getState().sessions['s1'];
      expect(session).toBeDefined();
      expect(session.entries).toEqual([]);
      expect(session.loading).toBe(true);
      expect(session.error).toBeNull();
      expect(session.approvalCount).toBe(0);
    });

    it('is idempotent — does not reset existing session', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      // Add some state
      act(() => {
        useSessionEventsStore.getState().setEntries('s1', [{ role: 'user', contentType: 'text', text: 'hi' } as ParsedEntry], 'running' as UIState);
      });

      const entriesBefore = useSessionEventsStore.getState().sessions['s1'].entries;

      // Ensure again — should not overwrite
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      expect(useSessionEventsStore.getState().sessions['s1'].entries).toBe(entriesBefore);
    });
  });

  describe('setEntries', () => {
    it('replaces entries and clears loading/error', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
        useSessionEventsStore.getState().setError('s1', 'previous error');
      });

      const entries: ParsedEntry[] = [
        { role: 'user', contentType: 'text', text: 'hello' } as ParsedEntry,
        { role: 'assistant', contentType: 'text', text: 'world' } as ParsedEntry,
      ];

      act(() => {
        useSessionEventsStore.getState().setEntries('s1', entries, 'running' as UIState);
      });

      const session = useSessionEventsStore.getState().sessions['s1'];
      expect(session.entries).toEqual(entries);
      expect(session.status).toBe('running');
      expect(session.loading).toBe(false);
      expect(session.error).toBeNull();
      expect(session.lastUpdatedAt).toBeGreaterThan(0);
    });

    it('creates session if it does not exist', () => {
      const entries: ParsedEntry[] = [];
      act(() => {
        useSessionEventsStore.getState().setEntries('new-session', entries, 'idle' as UIState);
      });

      expect(useSessionEventsStore.getState().sessions['new-session']).toBeDefined();
    });
  });

  describe('setMetrics', () => {
    it('sets metrics on an existing session', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      const metrics = { totalTokensIn: 100, totalTokensOut: 200, totalCost: 0.05 } as SessionMetrics;
      act(() => {
        useSessionEventsStore.getState().setMetrics('s1', metrics);
      });

      expect(useSessionEventsStore.getState().sessions['s1'].metrics).toEqual(metrics);
      expect(useSessionEventsStore.getState().sessions['s1'].lastUpdatedAt).toBeGreaterThan(0);
    });
  });

  describe('setLoading', () => {
    it('toggles loading flag', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      expect(useSessionEventsStore.getState().sessions['s1'].loading).toBe(true);

      act(() => {
        useSessionEventsStore.getState().setLoading('s1', false);
      });

      expect(useSessionEventsStore.getState().sessions['s1'].loading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets error and clears loading', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
        useSessionEventsStore.getState().setLoading('s1', true);
      });

      act(() => {
        useSessionEventsStore.getState().setError('s1', 'fetch failed');
      });

      const session = useSessionEventsStore.getState().sessions['s1'];
      expect(session.error).toBe('fetch failed');
      expect(session.loading).toBe(false);
    });

    it('clears error when set to null', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
        useSessionEventsStore.getState().setError('s1', 'oops');
      });

      act(() => {
        useSessionEventsStore.getState().setError('s1', null);
      });

      expect(useSessionEventsStore.getState().sessions['s1'].error).toBeNull();
    });
  });

  describe('incrementCounter', () => {
    it('increments approvalCount', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      act(() => {
        useSessionEventsStore.getState().incrementCounter('s1', 'approvalCount');
        useSessionEventsStore.getState().incrementCounter('s1', 'approvalCount');
      });

      expect(useSessionEventsStore.getState().sessions['s1'].approvalCount).toBe(2);
    });

    it('increments autoApprovalCount', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      act(() => {
        useSessionEventsStore.getState().incrementCounter('s1', 'autoApprovalCount');
      });

      expect(useSessionEventsStore.getState().sessions['s1'].autoApprovalCount).toBe(1);
    });

    it('increments statusChangeCount', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      act(() => {
        useSessionEventsStore.getState().incrementCounter('s1', 'statusChangeCount');
      });

      expect(useSessionEventsStore.getState().sessions['s1'].statusChangeCount).toBe(1);
    });
  });

  describe('clearSession', () => {
    it('removes a session from the map', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
        useSessionEventsStore.getState().ensureSession('s2');
      });

      act(() => {
        useSessionEventsStore.getState().clearSession('s1');
      });

      expect(useSessionEventsStore.getState().sessions['s1']).toBeUndefined();
      expect(useSessionEventsStore.getState().sessions['s2']).toBeDefined();
    });

    it('no-ops for non-existent session', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      const before = useSessionEventsStore.getState().sessions;
      act(() => {
        useSessionEventsStore.getState().clearSession('nonexistent');
      });

      expect(useSessionEventsStore.getState().sessions).toBe(before);
    });
  });

  describe('setSeek', () => {
    it('sets seekMs and increments seekNonce', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      act(() => {
        useSessionEventsStore.getState().setSeek('s1', 5000);
      });

      const session = useSessionEventsStore.getState().sessions['s1'];
      expect(session.seekMs).toBe(5000);
      expect(session.seekNonce).toBe(1);

      act(() => {
        useSessionEventsStore.getState().setSeek('s1', 5000);
      });

      const session2 = useSessionEventsStore.getState().sessions['s1'];
      expect(session2.seekMs).toBe(5000);
      expect(session2.seekNonce).toBe(2);
    });
  });

  describe('setModel', () => {
    it('sets the model name', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
      });

      act(() => {
        useSessionEventsStore.getState().setModel('s1', 'claude-opus-4-7');
      });

      expect(useSessionEventsStore.getState().sessions['s1'].model).toBe('claude-opus-4-7');
    });

    it('no-ops when model is unchanged', () => {
      act(() => {
        useSessionEventsStore.getState().ensureSession('s1');
        useSessionEventsStore.getState().setModel('s1', 'glm-5.1');
      });

      const before = useSessionEventsStore.getState().sessions;
      act(() => {
        useSessionEventsStore.getState().setModel('s1', 'glm-5.1');
      });

      expect(useSessionEventsStore.getState().sessions).toBe(before);
    });
  });
});

describe('selectors', () => {
  const textEntry = (role: 'user' | 'assistant'): ParsedEntry =>
    ({ role, contentType: 'text', text: 'msg' }) as ParsedEntry;

  const toolEntry: ParsedEntry = { role: 'assistant', contentType: 'tool_use' } as ParsedEntry;
  const thinkingEntry: ParsedEntry = { role: 'assistant', contentType: 'thinking' } as ParsedEntry;

  it('selectSession returns stable empty state for unknown session', () => {
    const state = useSessionEventsStore.getState();
    const result = selectSession(state, 'nonexistent');
    expect(result.entries).toEqual([]);
    expect(result.loading).toBe(true);
  });

  it('selectSession returns actual state for known session', () => {
    act(() => {
      useSessionEventsStore.getState().ensureSession('s1');
    });

    const state = useSessionEventsStore.getState();
    const result = selectSession(state, 's1');
    expect(result).toBe(state.sessions['s1']);
  });

  it('selectMessageCount counts user + assistant text entries', () => {
    const state = {
      entries: [textEntry('user'), textEntry('assistant'), toolEntry],
    } as any;
    expect(selectMessageCount(state)).toBe(2);
  });

  it('selectUserMessageCount counts only user text entries', () => {
    const state = {
      entries: [textEntry('user'), textEntry('assistant'), textEntry('user')],
    } as any;
    expect(selectUserMessageCount(state)).toBe(2);
  });

  it('selectAssistantMessageCount counts only assistant text entries', () => {
    const state = {
      entries: [textEntry('user'), textEntry('assistant'), toolEntry],
    } as any;
    expect(selectAssistantMessageCount(state)).toBe(1);
  });

  it('selectToolCallCount counts tool_use entries', () => {
    const state = {
      entries: [textEntry('user'), toolEntry, toolEntry],
    } as any;
    expect(selectToolCallCount(state)).toBe(2);
  });

  it('selectThinkingCount counts thinking entries', () => {
    const state = {
      entries: [thinkingEntry, textEntry('user'), thinkingEntry],
    } as any;
    expect(selectThinkingCount(state)).toBe(2);
  });
});

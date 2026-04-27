/**
 * useSessionRealtimeUpdates.test.ts — Tests for real-time SSE session updates hook.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { useSessionRealtimeUpdates } from '../hooks/useSessionRealtimeUpdates';
import { useStore } from '../store/useStore';
import type { SessionInfo, GlobalSSEEvent } from '../types';
import type { ActivityListItem } from '../store/useStore';

function makeActivity(event: string, sessionId: string, data: Record<string, unknown> = {}): ActivityListItem {
  const key = `key-${Math.random()}`;
  return {
    event: event as GlobalSSEEvent['event'],
    sessionId,
    timestamp: new Date().toISOString(),
    id: Math.random(),
    renderKey: key,
    data,
  };
}

function makeSession(id: string, status: string = 'working'): SessionInfo {
  return {
    id,
    windowId: `window-${id}`,
    windowName: `Session ${id}`,
    workDir: '/tmp',
    claudeSessionId: undefined,
    jsonlPath: undefined,
    byteOffset: 0,
    monitorOffset: 0,
    status: status as SessionInfo['status'],
    createdAt: Date.now() - 60000,
    lastActivity: Date.now(),
    stallThresholdMs: 30000,
    permissionMode: 'accept',
    autoApprove: false,
    permissionPromptAt: undefined,
    permissionRespondedAt: undefined,
  };
}

describe('useSessionRealtimeUpdates', () => {
  beforeEach(() => {
    // Reset store to known state
    useStore.setState({
      sessions: [makeSession('session-1', 'working')],
      activities: [],
      healthMap: {},
    });
  });

  it('updates session status on session_status_change event', () => {
    const { rerender } = renderHook(() => useSessionRealtimeUpdates());

    const activity = makeActivity('session_status_change', 'session-1', { status: 'idle' });
    act(() => {
      useStore.setState({ activities: [activity] });
    });

    rerender();

    const { sessions } = useStore.getState();
    expect(sessions.find((s) => s.id === 'session-1')?.status).toBe('idle');
  });

  it('removes session on session_ended event', () => {
    const { rerender } = renderHook(() => useSessionRealtimeUpdates());

    const activity = makeActivity('session_ended', 'session-1');
    act(() => {
      useStore.setState({ activities: [activity] });
    });

    rerender();

    const { sessions } = useStore.getState();
    expect(sessions.find((s) => s.id === 'session-1')).toBeUndefined();
  });

  it('adds new session on session_created event', () => {
    const { rerender } = renderHook(() => useSessionRealtimeUpdates());

    const newSession = makeSession('session-2', 'working');
    const activity = makeActivity('session_created', 'session-2', newSession as unknown as Record<string, unknown>);
    act(() => {
      useStore.setState({ activities: [activity] });
    });

    rerender();

    const { sessions } = useStore.getState();
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.id === 'session-2')).toBeDefined();
  });

  it('sets stall health on session_stall event', () => {
    const { rerender } = renderHook(() => useSessionRealtimeUpdates());

    const activity = makeActivity('session_stall', 'session-1');
    act(() => {
      useStore.setState({ activities: [activity] });
    });

    rerender();

    const { healthMap } = useStore.getState();
    expect(healthMap['session-1']?.health).toBe('stall');
    expect(healthMap['session-1']?.alive).toBe(true);
  });

  it('sets dead health on session_dead event', () => {
    const { rerender } = renderHook(() => useSessionRealtimeUpdates());

    const activity = makeActivity('session_dead', 'session-1');
    act(() => {
      useStore.setState({ activities: [activity] });
    });

    rerender();

    const { healthMap } = useStore.getState();
    expect(healthMap['session-1']?.health).toBe('dead');
    expect(healthMap['session-1']?.alive).toBe(false);
  });

  it('ignores global events', () => {
    const { rerender } = renderHook(() => useSessionRealtimeUpdates());

    const activity = makeActivity('session_status_change', 'global', { status: 'idle' });
    act(() => {
      useStore.setState({ activities: [activity] });
    });

    rerender();

    const { sessions } = useStore.getState();
    expect(sessions.find((s) => s.id === 'session-1')?.status).toBe('working');
  });

  it('does not duplicate session on duplicate session_created', () => {
    const { rerender } = renderHook(() => useSessionRealtimeUpdates());

    const newSession = makeSession('session-2', 'working');
    const activity = makeActivity('session_created', 'session-2', newSession as unknown as Record<string, unknown>);
    act(() => {
      useStore.setState({ activities: [activity] });
    });

    rerender();

    // Process same event again (simulated by same activities array)
    rerender();

    const { sessions } = useStore.getState();
    expect(sessions.filter((s) => s.id === 'session-2')).toHaveLength(1);
  });
});

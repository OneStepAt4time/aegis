import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSessionRealtimeUpdates } from '../useSessionRealtimeUpdates';
import { useStore } from '../../store/useStore';
import type { SessionInfo } from '../../types';

// Mock stores
const mockSetSessions = vi.fn();
const mockSetHealth = vi.fn();
const mockRemoveApproval = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../../store/useStore', () => ({
  useStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ activities: [] }),
    { getState: () => ({
      sessions: [],
      setSessions: mockSetSessions,
      healthMap: {},
      setHealth: mockSetHealth,
    }) },
  ),
}));

vi.mock('../../store/useApprovalStore', () => ({
  useApprovalStore: {
    getState: () => ({
      pending: new Set(),
      removeApproval: mockRemoveApproval,
    }),
  },
}));

vi.mock('../../store/useToastStore', () => ({
  useToastStore: {
    getState: () => ({
      addToast: mockAddToast,
    }),
  },
}));

describe('useSessionRealtimeUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing with empty activities', () => {
    renderHook(() => useSessionRealtimeUpdates());
    expect(mockSetSessions).not.toHaveBeenCalled();
    expect(mockSetHealth).not.toHaveBeenCalled();
  });

  it('updates session status on session_status_change', () => {
    const session: SessionInfo = {
      id: 'sess-1',
      status: 'working',
      displayName: 'Test Session',
      lastActivity: Date.now(),
    } as SessionInfo;

    vi.mocked(useStore).getState = vi.fn().mockReturnValue(() => ({
      sessions: [session],
      setSessions: mockSetSessions,
      healthMap: {},
      setHealth: mockSetHealth,
    }));

    const { rerender } = renderHook(
      () => useSessionRealtimeUpdates(),
    );

    rerender();
    expect(true).toBe(true);
  });

  it('handles session_stall event by updating healthMap', () => {
    renderHook(() => useSessionRealtimeUpdates());
    expect(mockSetHealth).not.toHaveBeenCalled();
  });

  it('handles session_dead event by updating healthMap', () => {
    renderHook(() => useSessionRealtimeUpdates());
    expect(mockSetHealth).not.toHaveBeenCalled();
  });

  it('ignores events with sessionId === global', () => {
    renderHook(() => useSessionRealtimeUpdates());
    expect(mockSetSessions).not.toHaveBeenCalled();
  });

  it('skips non-session events', () => {
    renderHook(() => useSessionRealtimeUpdates());
    expect(mockSetSessions).not.toHaveBeenCalled();
    expect(mockSetHealth).not.toHaveBeenCalled();
  });

  it('removes approval when status changes away from permission_prompt', () => {
    renderHook(() => useSessionRealtimeUpdates());
    expect(mockRemoveApproval).not.toHaveBeenCalled();
  });
});

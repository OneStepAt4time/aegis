import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockPauseSession = vi.fn();
const mockStartIntervention = vi.fn();
const mockCompleteIntervention = vi.fn();
const mockResumeSession = vi.fn();
const mockGetSessionIntervention = vi.fn();

vi.mock('../../api/acp-pause-client', () => ({
  pauseSession: (...args: unknown[]) => mockPauseSession(...args),
  startIntervention: (...args: unknown[]) => mockStartIntervention(...args),
  completeIntervention: (...args: unknown[]) => mockCompleteIntervention(...args),
  resumeSession: (...args: unknown[]) => mockResumeSession(...args),
  getSessionIntervention: (...args: unknown[]) => mockGetSessionIntervention(...args),
}));

const mockIntervention = {
  pauseId: 'pause-1',
  sessionId: 'sess-1',
  status: 'paused' as const,
  pausedAt: new Date().toISOString(),
};

describe('useSessionIntervention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null intervention when no sessionId', async () => {
    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention(undefined));
    expect(result.current.intervention).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches intervention on mount', async () => {
    mockGetSessionIntervention.mockResolvedValue(mockIntervention);

    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention('sess-1'));

    await waitFor(() => {
      expect(mockGetSessionIntervention).toHaveBeenCalledWith('sess-1');
    });

    await waitFor(() => {
      expect(result.current.intervention).toEqual(mockIntervention);
    });
  });

  it('pauses session', async () => {
    mockGetSessionIntervention.mockResolvedValue(null);
    mockPauseSession.mockResolvedValue({ pause: mockIntervention });

    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention('sess-1'));

    await act(async () => {
      await result.current.pause({ reason: 'user requested' });
    });

    expect(mockPauseSession).toHaveBeenCalledWith('sess-1', { reason: 'user requested' });
    expect(result.current.intervention).toEqual(mockIntervention);
  });

  it('starts intervention', async () => {
    const interveningRecord = { ...mockIntervention, status: 'intervening' };
    mockGetSessionIntervention.mockResolvedValue(null);
    mockStartIntervention.mockResolvedValue({ pause: interveningRecord });

    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention('sess-1'));

    await act(async () => {
      await result.current.intervene();
    });

    expect(mockStartIntervention).toHaveBeenCalledWith('sess-1');
    expect(result.current.intervention).toEqual(interveningRecord);
  });

  it('completes intervention', async () => {
    const completedRecord = { ...mockIntervention, status: 'intervention_complete' };
    mockGetSessionIntervention.mockResolvedValue(null);
    mockCompleteIntervention.mockResolvedValue({ pause: completedRecord });

    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention('sess-1'));

    await act(async () => {
      await result.current.completeIntervention({ guidance: 'Fixed the bug' });
    });

    expect(mockCompleteIntervention).toHaveBeenCalledWith('sess-1', { guidance: 'Fixed the bug' });
  });

  it('resumes session', async () => {
    mockGetSessionIntervention.mockResolvedValue(null);
    mockResumeSession.mockResolvedValue({ pause: null });

    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention('sess-1'));

    await act(async () => {
      await result.current.resume({ resumedBy: 'approved' });
    });

    expect(mockResumeSession).toHaveBeenCalledWith('sess-1', { resumedBy: 'approved' });
  });

  it('handles errors', async () => {
    mockGetSessionIntervention.mockResolvedValue(null);
    mockPauseSession.mockRejectedValue(new Error('Failed to pause'));

    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention('sess-1'));

    await act(async () => {
      await result.current.pause({ reason: 'test' });
    });

    expect(result.current.error).toBe('Failed to pause');
  });

  it('clears error', async () => {
    mockGetSessionIntervention.mockResolvedValue(null);
    mockPauseSession.mockRejectedValue(new Error('fail'));

    const { useSessionIntervention } = await import('../useSessionIntervention');
    const { result } = renderHook(() => useSessionIntervention('sess-1'));

    await act(async () => {
      await result.current.pause({ reason: 'test' });
    });
    expect(result.current.error).toBe('fail');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

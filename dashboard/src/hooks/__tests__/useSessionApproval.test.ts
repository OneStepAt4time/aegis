import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockGetPending = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();

vi.mock('../../api/acp-approval-client', () => ({
  getPendingApproval: (...args: unknown[]) => mockGetPending(...args),
  approveTool: (...args: unknown[]) => mockApprove(...args),
  rejectTool: (...args: unknown[]) => mockReject(...args),
}));

describe('useSessionApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null state when no sessionId', async () => {
    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval(undefined));
    expect(result.current.pendingApproval).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches pending approval on mount', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => {
      expect(result.current.pendingApproval).toEqual(mockApproval);
    });

    expect(mockGetPending).toHaveBeenCalledWith('sess-1');
  });

  it('approves pending tool', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);
    mockApprove.mockResolvedValue(undefined);

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => expect(result.current.pendingApproval).toBeTruthy());

    await act(async () => {
      await result.current.approve('looks good');
    });

    expect(mockApprove).toHaveBeenCalledWith('sess-1', {
      approvalId: 'appr-1',
      reason: 'looks good',
    });
    expect(result.current.pendingApproval).toBeNull();
  });

  it('rejects pending tool', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);
    mockReject.mockResolvedValue(undefined);

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => expect(result.current.pendingApproval).toBeTruthy());

    await act(async () => {
      await result.current.reject('unsafe');
    });

    expect(mockReject).toHaveBeenCalledWith('sess-1', {
      approvalId: 'appr-1',
      reason: 'unsafe',
    });
    expect(result.current.pendingApproval).toBeNull();
  });

  it('handles approve error', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);
    mockApprove.mockRejectedValue(new Error('Network error'));

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => expect(result.current.pendingApproval).toBeTruthy());

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).toBe('Network error');
  });

  it('clears error', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);
    mockApprove.mockRejectedValue(new Error('fail'));

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => expect(result.current.pendingApproval).toBeTruthy());

    await act(async () => {
      await result.current.approve();
    });
    expect(result.current.error).toBe('fail');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('detects expired approval', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => {
      expect(result.current.pendingApproval).toBeTruthy();
      expect(result.current.isExpired).toBe(true);
    });
  });

  // Additional tests for branch coverage

  it('handles non-Error approve rejection', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);
    mockApprove.mockRejectedValue('string error');

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => expect(result.current.pendingApproval).toBeTruthy());

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.error).toBe('Failed to approve tool');
  });

  it('handles reject error', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);
    mockReject.mockRejectedValue(new Error('Reject failed'));

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => expect(result.current.pendingApproval).toBeTruthy());

    await act(async () => {
      await result.current.reject();
    });

    expect(result.current.error).toBe('Reject failed');
  });

  it('handles non-Error reject rejection', async () => {
    const mockApproval = {
      approvalId: 'appr-1',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date().toISOString(),
    };
    mockGetPending.mockResolvedValue(mockApproval);
    mockReject.mockRejectedValue('string error');

    const { useSessionApproval } = await import('../useSessionApproval');
    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await waitFor(() => expect(result.current.pendingApproval).toBeTruthy());

    await act(async () => {
      await result.current.reject();
    });

    expect(result.current.error).toBe('Failed to reject tool');
  });

  it('does not re-render when countdown text has not changed', async () => {
    const now = Date.now();
    const expiresAt = new Date(now + 90_000).toISOString();
    const mockApproval = {
      approvalId: 'appr-ttl',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date(now).toISOString(),
      expiresAt,
    };
    mockGetPending.mockResolvedValue(mockApproval);

    const { useSessionApproval } = await import('../useSessionApproval');

    vi.useFakeTimers({ shouldAdvanceTime: false, now: new Date(now) });

    const { result } = renderHook(() => useSessionApproval('sess-1'));

    // Flush the initial fetch
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pendingApproval).toBeTruthy();
    const initialCountdown = result.current.countdown;
    expect(initialCountdown).toBe('1:30');

    // Advance 500ms — still same formatted second, setCountdown guard prevents re-render
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.countdown).toBe(initialCountdown);

    // Advance to the full second — countdown should tick to "1:29"
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.countdown).toBe('1:29');

    vi.useRealTimers();
  });

  it('updates remainingMs on each tick', async () => {
    const now = Date.now();
    const expiresAt = new Date(now + 5000).toISOString();
    const mockApproval = {
      approvalId: 'appr-ms',
      toolName: 'Bash',
      sessionId: 'sess-1',
      requestedAt: new Date(now).toISOString(),
      expiresAt,
    };
    mockGetPending.mockResolvedValue(mockApproval);

    const { useSessionApproval } = await import('../useSessionApproval');

    vi.useFakeTimers({ shouldAdvanceTime: false, now: new Date(now) });

    const { result } = renderHook(() => useSessionApproval('sess-1'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pendingApproval).toBeTruthy();
    const initialMs = result.current.remainingMs;
    expect(initialMs).not.toBeNull();
    expect(initialMs!).toBeGreaterThan(0);

    // After 1 second, remainingMs should decrease
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.remainingMs).toBeLessThan(initialMs!);

    vi.useRealTimers();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockClaimDriver = vi.fn();
const mockReleaseDriver = vi.fn();
const mockTransferDriver = vi.fn();
const mockGetSessionParticipants = vi.fn();

vi.mock('../../api/acp-driver-client', () => ({
  claimDriver: (...args: unknown[]) => mockClaimDriver(...args),
  releaseDriver: (...args: unknown[]) => mockReleaseDriver(...args),
  transferDriver: (...args: unknown[]) => mockTransferDriver(...args),
  getSessionParticipants: (...args: unknown[]) => mockGetSessionParticipants(...args),
}));

const mockParticipants = {
  sessionId: 'sess-1',
  driver: { subscriberId: 'user-1', claimedAt: new Date().toISOString() },
  observers: [],
};

describe('useSessionParticipants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no sessionId', async () => {
    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants(undefined));
    expect(result.current.participants).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches participants on mount', async () => {
    mockGetSessionParticipants.mockResolvedValue(mockParticipants);

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1'));

    await waitFor(() => {
      expect(mockGetSessionParticipants).toHaveBeenCalledWith('sess-1');
    });

    await waitFor(() => {
      expect(result.current.participants).toEqual(mockParticipants);
    });
  });

  it('detects isDriver correctly', async () => {
    mockGetSessionParticipants.mockResolvedValue(mockParticipants);

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1', 'user-1'));

    await waitFor(() => {
      expect(result.current.isDriver).toBe(true);
    });
  });

  it('detects non-driver correctly', async () => {
    mockGetSessionParticipants.mockResolvedValue(mockParticipants);

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1', 'user-2'));

    await waitFor(() => {
      expect(result.current.isDriver).toBe(false);
    });
  });

  it('claims driver role', async () => {
    mockGetSessionParticipants.mockResolvedValue(null);
    mockClaimDriver.mockResolvedValue(undefined);

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1', 'user-2'));

    await act(async () => {
      await result.current.claim({ holderId: "user-2" });
    });

    expect(mockClaimDriver).toHaveBeenCalledWith('sess-1', { holderId: "user-2" });
  });

  it('releases driver role', async () => {
    mockGetSessionParticipants.mockResolvedValue(mockParticipants);
    mockReleaseDriver.mockResolvedValue(undefined);
    mockGetSessionParticipants.mockResolvedValue({ ...mockParticipants, driver: null });

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1', 'user-1'));

    await waitFor(() => expect(result.current.participants).toBeTruthy());

    await act(async () => {
      await result.current.release();
    });

    expect(mockReleaseDriver).toHaveBeenCalledWith('sess-1');
  });

  it('transfers driver role', async () => {
    mockGetSessionParticipants.mockResolvedValue(mockParticipants);
    mockTransferDriver.mockResolvedValue(undefined);

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1', 'user-1'));

    await waitFor(() => expect(result.current.participants).toBeTruthy());

    await act(async () => {
      await result.current.transfer({ targetSubscriberId: 'user-2' });
    });

    expect(mockTransferDriver).toHaveBeenCalledWith('sess-1', { targetSubscriberId: 'user-2' });
  });

  it('handles errors', async () => {
    mockGetSessionParticipants.mockResolvedValue(null);
    mockClaimDriver.mockRejectedValue(new Error('Already claimed'));

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1'));

    await act(async () => {
      await result.current.claim();
    });

    expect(result.current.error).toBe('Already claimed');
  });

  it('clears error', async () => {
    mockGetSessionParticipants.mockResolvedValue(null);
    mockClaimDriver.mockRejectedValue(new Error('fail'));

    const { useSessionParticipants } = await import('../useSessionParticipants');
    const { result } = renderHook(() => useSessionParticipants('sess-1'));

    await act(async () => {
      await result.current.claim();
    });
    expect(result.current.error).toBe('fail');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

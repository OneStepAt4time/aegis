import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessionTimeline } from '../useSessionTimeline';

vi.mock('../../api/acp-timeline-client', () => ({
  replaySessionEvents: vi.fn(),
}));

import { replaySessionEvents } from '../../api/acp-timeline-client';

describe('useSessionTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with empty events and no error', () => {
    (replaySessionEvents as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSessionTimeline('s1'));
    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('loads events on mount', async () => {
    const mockEvents = [{ type: 'start', ts: 1000 }];
    (replaySessionEvents as ReturnType<typeof vi.fn>).mockResolvedValue(mockEvents);

    const { result } = renderHook(() => useSessionTimeline('s1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.events).toEqual(mockEvents);
    expect(result.current.error).toBeNull();
  });

  it('sets error on fetch failure', async () => {
    (replaySessionEvents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSessionTimeline('s1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Network error');
  });

  it('does not fetch when sessionId is undefined', () => {
    (replaySessionEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderHook(() => useSessionTimeline(undefined));
    expect(replaySessionEvents).not.toHaveBeenCalled();
  });

  it('clearError clears the error', async () => {
    (replaySessionEvents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useSessionTimeline('s1'));

    await waitFor(() => expect(result.current.error).toBe('fail'));
    await act(async () => { result.current.clearError(); });
    expect(result.current.error).toBeNull();
  });
});

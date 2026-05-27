import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock useToastStore
vi.mock('../../store/useToastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown) => selector({ addToast: mockAddToast }),
    { getState: () => ({ addToast: mockAddToast }) },
  ),
}));

const mockAddToast = vi.fn();

describe('useOptimistic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with isPending false', async () => {
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() => useOptimistic(async () => 'ok'));
    expect(result.current.isPending).toBe(false);
  });

  it('sets isPending true during execution', async () => {
    let resolveAction: (v: string) => void;
    const action = () => new Promise<string>(r => { resolveAction = r; });
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() => useOptimistic(action));
    act(() => { result.current.execute(); });
    expect(result.current.isPending).toBe(true);
    await act(async () => { resolveAction!('done'); });
    expect(result.current.isPending).toBe(false);
  });

  it('calls optimisticUpdate immediately', async () => {
    const optimisticUpdate = vi.fn();
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() =>
      useOptimistic(async () => 'ok', { optimisticUpdate }),
    );
    expect(optimisticUpdate).not.toHaveBeenCalled();
    await act(async () => { await result.current.execute(); });
    expect(optimisticUpdate).toHaveBeenCalled();
  });

  it('shows success toast on success', async () => {
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() =>
      useOptimistic(async () => 'ok', { successMessage: 'It worked!' }),
    );
    await act(async () => { await result.current.execute(); });
    expect(mockAddToast).toHaveBeenCalledWith('success', 'It worked!');
  });

  it('does not show toast when no successMessage', async () => {
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() => useOptimistic(async () => 'ok'));
    await act(async () => { await result.current.execute(); });
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('calls rollback and shows error toast on failure', async () => {
    const rollback = vi.fn();
    const action = () => Promise.reject(new Error('fail'));
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() =>
      useOptimistic(action, { rollback, errorMessage: 'Oops' }),
    );
    await act(async () => { await result.current.execute(); });
    expect(rollback).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith('error', 'Oops');
  });

  it('shows default error message on failure', async () => {
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() =>
      useOptimistic(() => Promise.reject(new Error('nope'))),
    );
    await act(async () => { await result.current.execute(); });
    expect(mockAddToast).toHaveBeenCalledWith('error', 'Something went wrong');
  });

  it('calls onSuccess with result', async () => {
    const onSuccess = vi.fn();
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() =>
      useOptimistic(async () => 42, { onSuccess }),
    );
    await act(async () => { await result.current.execute(); });
    expect(onSuccess).toHaveBeenCalledWith(42);
  });

  it('calls onError with error', async () => {
    const onError = vi.fn();
    const err = new Error('boom');
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() =>
      useOptimistic(() => Promise.reject(err), { onError }),
    );
    await act(async () => { await result.current.execute(); });
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('returns undefined when already pending', async () => {
    let resolveFirst: (v: string) => void;
    const firstAction = () => new Promise<string>(r => { resolveFirst = r; });
    const { useOptimistic } = await import('../useOptimistic');
    const { result } = renderHook(() => useOptimistic(firstAction));
    
    act(() => { result.current.execute(); });
    const secondResult = await act(async () => { return await result.current.execute(); });
    expect(secondResult).toBeUndefined();

    await act(async () => { resolveFirst!('done'); });
  });
});

/**
 * __tests__/useOptimistic.test.ts — Unit tests for the useOptimistic hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOptimistic } from '../hooks/useOptimistic';
import { useToastStore } from '../store/useToastStore';

describe('useOptimistic', () => {
  beforeEach(() => {
    // Clear all toasts before each test
    act(() => {
      useToastStore.getState().toasts.forEach((t) => {
        useToastStore.getState().removeToast(t.id);
      });
    });
  });

  it('calls the action on execute', async () => {
    const action = vi.fn().mockResolvedValue('result');
    const { result } = renderHook(() => useOptimistic(action));

    await act(async () => {
      await result.current.execute();
    });

    expect(action).toHaveBeenCalledOnce();
  });

  it('returns isPending=true while action is in flight', async () => {
    let resolve!: (v: string) => void;
    const action = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const { result } = renderHook(() => useOptimistic(action));

    let executePromise: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute();
    });

    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolve('done');
      await executePromise;
    });

    expect(result.current.isPending).toBe(false);
  });

  it('calls optimisticUpdate before the action', async () => {
    const calls: string[] = [];
    const action = vi.fn(async () => { calls.push('action'); return 'ok'; });
    const optimisticUpdate = vi.fn(() => calls.push('optimistic'));

    const { result } = renderHook(() =>
      useOptimistic(action, { optimisticUpdate }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(calls).toEqual(['optimistic', 'action']);
  });

  it('calls rollback on failure', async () => {
    const action = vi.fn().mockRejectedValue(new Error('fail'));
    const rollback = vi.fn();

    const { result } = renderHook(() =>
      useOptimistic(action, { rollback }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(rollback).toHaveBeenCalledOnce();
  });

  it('shows success toast on success', async () => {
    const action = vi.fn().mockResolvedValue('ok');
    const { result } = renderHook(() =>
      useOptimistic(action, { successMessage: 'Done!' }),
    );

    await act(async () => {
      await result.current.execute();
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.title === 'Done!' && t.type === 'success')).toBe(true);
  });

  it('shows error toast on failure', async () => {
    const action = vi.fn().mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() =>
      useOptimistic(action, { errorMessage: 'Oh no!' }),
    );

    await act(async () => {
      await result.current.execute();
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.title === 'Oh no!' && t.type === 'error')).toBe(true);
  });

  it('shows default error toast when no errorMessage provided', async () => {
    const action = vi.fn().mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useOptimistic(action));

    await act(async () => {
      await result.current.execute();
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.type === 'error')).toBe(true);
  });

  it('calls onSuccess callback with the result', async () => {
    const action = vi.fn().mockResolvedValue('myResult');
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useOptimistic(action, { onSuccess }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onSuccess).toHaveBeenCalledWith('myResult');
  });

  it('calls onError callback on failure', async () => {
    const error = new Error('boom');
    const action = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useOptimistic(action, { onError }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('prevents concurrent executions', async () => {
    let resolve!: (v: string) => void;
    const action = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const { result } = renderHook(() => useOptimistic(action));

    act(() => {
      void result.current.execute();
      void result.current.execute(); // second call should be ignored
    });

    await act(async () => {
      resolve('done');
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(action).toHaveBeenCalledOnce();
  });
});

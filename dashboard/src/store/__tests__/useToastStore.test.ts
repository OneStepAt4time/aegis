/**
 * useToastStore.test.ts — Tests for toast notification store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore } from '../useToastStore';

describe('useToastStore', () => {
  beforeEach(() => {
    // Clear toasts between tests
    const { toasts } = useToastStore.getState();
    toasts.forEach((t) => useToastStore.getState().removeToast(t.id));
  });

  it('starts with empty toasts', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('addToast creates a toast and returns its id', () => {
    const id = useToastStore.getState().addToast('success', 'Test title', 'Test desc');
    expect(id).toBeTruthy();
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(id);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].title).toBe('Test title');
    expect(toasts[0].description).toBe('Test desc');
  });

  it('removeToast removes a specific toast', () => {
    const id1 = useToastStore.getState().addToast('info', 'Toast 1');
    useToastStore.getState().addToast('error', 'Toast 2');
    expect(useToastStore.getState().toasts).toHaveLength(2);

    useToastStore.getState().removeToast(id1);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].title).toBe('Toast 2');
  });

  it('auto-dismisses toast after duration', () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast('info', 'Auto toast', undefined, { duration: 3000 });
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('evicts oldest toasts beyond MAX (4)', () => {
    for (let i = 0; i < 6; i++) {
      useToastStore.getState().addToast('info', `Toast ${i}`);
    }
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(4);
    // Should keep the last 4 (Toast 2-5)
    expect(toasts[0].title).toBe('Toast 2');
    expect(toasts[3].title).toBe('Toast 5');
  });

  it('stores undoAction when provided', () => {
    const undo = vi.fn();
    useToastStore.getState().addToast('undo', 'Undo me', undefined, { undoAction: undo });
    const toast = useToastStore.getState().toasts[0];
    expect(toast.undoAction).toBe(undo);
  });
});

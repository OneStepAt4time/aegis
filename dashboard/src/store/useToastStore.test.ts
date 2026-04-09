import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useToastStore } from './useToastStore.js';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useToastStore', () => {
  describe('addToast', () => {
    it('adds a toast and returns its id', () => {
      const id = useToastStore.getState().addToast('success', 'Done');
      expect(id).toMatch(/^toast-\d+$/);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      expect(useToastStore.getState().toasts[0]).toEqual({
        id,
        type: 'success',
        title: 'Done',
        description: undefined,
      });
    });

    it('adds a toast with description', () => {
      const id = useToastStore.getState().addToast('error', 'Fail', 'Details here');
      expect(useToastStore.getState().toasts[0].description).toBe('Details here');
    });

    it('auto-dismisses after 4000ms', () => {
      useToastStore.getState().addToast('info', 'Auto');
      expect(useToastStore.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(3999);
      expect(useToastStore.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('removeToast', () => {
    it('removes a toast by id', () => {
      const id = useToastStore.getState().addToast('warning', 'Heads up');
      expect(useToastStore.getState().toasts).toHaveLength(1);

      useToastStore.getState().removeToast(id);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('does nothing for non-existent id', () => {
      useToastStore.getState().addToast('info', 'Stays');
      useToastStore.getState().removeToast('non-existent');
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('clears the auto-dismiss timer', () => {
      const id = useToastStore.getState().addToast('info', 'Manual dismiss');
      useToastStore.getState().removeToast(id);

      vi.advanceTimersByTime(5000);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('multiple toasts', () => {
    it('manages multiple toasts independently', () => {
      const id1 = useToastStore.getState().addToast('success', 'First');
      const id2 = useToastStore.getState().addToast('error', 'Second');
      expect(useToastStore.getState().toasts).toHaveLength(2);

      useToastStore.getState().removeToast(id1);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      expect(useToastStore.getState().toasts[0].title).toBe('Second');
    });
  });
});

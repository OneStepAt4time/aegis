import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimerRegistry } from '../utils/timer-registry.js';

describe('TimerRegistry', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    registry.clearAll();
    vi.useRealTimers();
  });

  describe('setTimeout', () => {
    it('wraps setTimeout and fires callback after delay', () => {
      const fn = vi.fn();
      registry.setTimeout(fn, 100);
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('tracks active timer and removes after firing', () => {
      registry.setTimeout(() => {}, 100);
      expect(registry.activeCount).toBe(1);
      vi.advanceTimersByTime(100);
      expect(registry.activeCount).toBe(0);
    });

    it('passes through extra arguments', () => {
      const fn = vi.fn();
      registry.setTimeout(fn, 50, 'a', 'b');
      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledWith('a', 'b');
    });
  });

  describe('setInterval', () => {
    it('wraps setInterval and fires repeatedly', () => {
      const fn = vi.fn();
      registry.setInterval(fn, 100);
      vi.advanceTimersByTime(350);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('tracks interval and clears when clearInterval is called', () => {
      const fn = vi.fn();
      const id = registry.setInterval(fn, 100);
      expect(registry.activeCount).toBe(1);
      registry.clearInterval(id);
      expect(registry.activeCount).toBe(0);
      vi.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledTimes(0);
    });
  });

  describe('clearTimeout', () => {
    it('prevents callback from firing', () => {
      const fn = vi.fn();
      const id = registry.setTimeout(fn, 100);
      registry.clearTimeout(id);
      vi.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledTimes(0);
    });

    it('untracks the timer', () => {
      const id = registry.setTimeout(() => {}, 100);
      expect(registry.activeCount).toBe(1);
      registry.clearTimeout(id);
      expect(registry.activeCount).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('clears all tracked timeouts and intervals', () => {
      registry.setTimeout(() => {}, 1000);
      registry.setInterval(() => {}, 1000);
      registry.setTimeout(() => {}, 2000);
      expect(registry.activeCount).toBe(3);
      registry.clearAll();
      expect(registry.activeCount).toBe(0);
    });

    it('prevents all callbacks from firing', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      registry.setTimeout(fn1, 100);
      registry.setInterval(fn2, 50);
      registry.clearAll();
      vi.advanceTimersByTime(500);
      expect(fn1).toHaveBeenCalledTimes(0);
      expect(fn2).toHaveBeenCalledTimes(0);
    });
  });

  describe('activeCount', () => {
    it('returns 0 for new registry', () => {
      expect(registry.activeCount).toBe(0);
    });

    it('increases when timers are added, decreases when cleared or fired', () => {
      expect(registry.activeCount).toBe(0);
      registry.setTimeout(() => {}, 100);
      expect(registry.activeCount).toBe(1);
      registry.setInterval(() => {}, 100);
      expect(registry.activeCount).toBe(2);
      vi.advanceTimersByTime(100);
      expect(registry.activeCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles idempotent clearAll calls', () => {
      registry.clearAll();
      registry.clearAll();
      expect(registry.activeCount).toBe(0);
    });

    it('handles setTimeout with delay 0', () => {
      const fn = vi.fn();
      registry.setTimeout(fn, 0);
      vi.advanceTimersByTime(0);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(registry.activeCount).toBe(0);
    });

    it('still tracks timer after clearInterval even if clearAll is called later', () => {
      const id = registry.setInterval(() => {}, 100);
      registry.clearInterval(id);
      expect(registry.activeCount).toBe(0);
      registry.clearAll();
      expect(registry.activeCount).toBe(0);
    });
  });
});

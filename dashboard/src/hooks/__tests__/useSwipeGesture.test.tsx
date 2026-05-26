import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSwipeGesture } from '../useSwipeGesture';

// jsdom doesn't implement Touch — polyfill
class MockTouch {
  identifier: number;
  target: EventTarget;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  screenX: number;
  screenY: number;
  radiusX = 0;
  radiusY = 0;
  rotationAngle = 0;
  force = 1;
  constructor(init: { identifier: number; target: EventTarget; clientX: number; clientY: number }) {
    this.identifier = init.identifier;
    this.target = init.target;
    this.clientX = init.clientX;
    this.clientY = init.clientY;
    this.pageX = init.clientX;
    this.pageY = init.clientY;
    this.screenX = init.clientX;
    this.screenY = init.clientY;
  }
}

// @ts-expect-error polyfill
globalThis.Touch = MockTouch;

function createTouchEvent(type: string, x: number, y: number) {
  return new TouchEvent(type, {
    touches: type === 'touchstart' ? [new MockTouch({ identifier: 0, target: window, clientX: x, clientY: y })] : [],
    changedTouches: type === 'touchend' ? [new MockTouch({ identifier: 0, target: window, clientX: x, clientY: y })] : [],
    bubbles: true,
  });
}

describe('useSwipeGesture', () => {
  it('detects right swipe', () => {
    const onSwipe = vi.fn();
    renderHook(() => useSwipeGesture({ onSwipe, threshold: 50 }));

    window.dispatchEvent(createTouchEvent('touchstart', 100, 200));
    window.dispatchEvent(createTouchEvent('touchend', 200, 200));

    expect(onSwipe).toHaveBeenCalledWith('right', { x: 200, y: 200 });
  });

  it('detects left swipe', () => {
    const onSwipe = vi.fn();
    renderHook(() => useSwipeGesture({ onSwipe, threshold: 50 }));

    window.dispatchEvent(createTouchEvent('touchstart', 200, 200));
    window.dispatchEvent(createTouchEvent('touchend', 100, 200));

    expect(onSwipe).toHaveBeenCalledWith('left', { x: 100, y: 200 });
  });

  it('ignores swipes below threshold', () => {
    const onSwipe = vi.fn();
    renderHook(() => useSwipeGesture({ onSwipe, threshold: 50 }));

    window.dispatchEvent(createTouchEvent('touchstart', 100, 200));
    window.dispatchEvent(createTouchEvent('touchend', 120, 200));

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('does not fire when disabled', () => {
    const onSwipe = vi.fn();
    renderHook(() => useSwipeGesture({ onSwipe, enabled: false, threshold: 50 }));

    window.dispatchEvent(createTouchEvent('touchstart', 100, 200));
    window.dispatchEvent(createTouchEvent('touchend', 200, 200));

    expect(onSwipe).not.toHaveBeenCalled();
  });

  it('ignores edge swipes (browser back gesture)', () => {
    const onSwipe = vi.fn();
    renderHook(() => useSwipeGesture({ onSwipe, threshold: 50, edgeExclusion: 30 }));

    // Start at x=10 (within 30px edge exclusion)
    window.dispatchEvent(createTouchEvent('touchstart', 10, 200));
    window.dispatchEvent(createTouchEvent('touchend', 100, 200));

    expect(onSwipe).not.toHaveBeenCalled();
  });
});

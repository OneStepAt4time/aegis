import { useEffect, useRef } from 'react';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

interface SwipeGestureOptions {
  onSwipe: (direction: SwipeDirection, touchPoint: { x: number; y: number }) => void;
  threshold?: number;
  enabled?: boolean;
  /** Attach to a specific element instead of window */
  elementRef?: React.RefObject<HTMLElement | null>;
  /** Ignore swipes starting within N px of screen edge (default: 30) */
  edgeExclusion?: number;
}

export function useSwipeGesture({
  onSwipe,
  threshold = 50,
  enabled = true,
  elementRef,
  edgeExclusion = 30,
}: SwipeGestureOptions) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const target = elementRef?.current ?? window;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      // Ignore edge swipes that could conflict with browser back gesture
      if (
        touch.clientX < edgeExclusion ||
        touch.clientX > window.innerWidth - edgeExclusion ||
        touch.clientY < edgeExclusion ||
        touch.clientY > window.innerHeight - edgeExclusion
      ) {
        return;
      }
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX > threshold || absDeltaY > threshold) {
        let direction: SwipeDirection;
        if (absDeltaX > absDeltaY) {
          direction = deltaX > 0 ? 'right' : 'left';
        } else {
          direction = deltaY > 0 ? 'down' : 'up';
        }
        onSwipe(direction, { x: touch.clientX, y: touch.clientY });
      }

      touchStartRef.current = null;
    };

    (target as Window & HTMLElement).addEventListener('touchstart', handleTouchStart as EventListener, { passive: true });
    (target as Window & HTMLElement).addEventListener('touchend', handleTouchEnd as EventListener, { passive: true });

    return () => {
      (target as Window & HTMLElement).removeEventListener('touchstart', handleTouchStart as EventListener);
      (target as Window & HTMLElement).removeEventListener('touchend', handleTouchEnd as EventListener);
    };
  }, [onSwipe, threshold, enabled, elementRef, edgeExclusion]);
}

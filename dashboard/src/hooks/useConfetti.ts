/**
 * hooks/useConfetti.ts
 *
 * Confetti burst on first session creation.
 * Uses canvas-confetti library with brand colors.
 */

import { useRef } from 'react';
import confetti from 'canvas-confetti';

export function useConfetti() {
  const hasTriggeredRef = useRef(false);

  function triggerFirstSessionConfetti(originElement?: HTMLElement) {
    const hasTriggered = localStorage.getItem('aegis:first-session');
    if (hasTriggered || hasTriggeredRef.current) {
      return;
    }

    hasTriggeredRef.current = true;
    localStorage.setItem('aegis:first-session', 'done');

    const origin = originElement
      ? {
          x: originElement.getBoundingClientRect().left / window.innerWidth,
          y: originElement.getBoundingClientRect().top / window.innerHeight,
        }
      : { x: 0.5, y: 0.5 };

    confetti({
      particleCount: 100,
      spread: 70,
      origin,
      colors: ['#22c55e', '#06b6d4', '#ffffff'],
      ticks: 200,
      gravity: 1,
      decay: 0.94,
      startVelocity: 30,
    });
  }

  return { triggerFirstSessionConfetti };
}

export default useConfetti;

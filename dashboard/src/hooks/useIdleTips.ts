/**
 * hooks/useIdleTips.ts — Hook for rotating actionable tips after idle time on empty pages.
 */

import { useEffect, useState } from 'react';

const IDLE_TIME_MS = 10_000;

const DEFAULT_TIPS = [
  'Run `ag create \'task\'` to start a session',
  'Press ⌘N to open the new session drawer',
  'Connect with `ag mcp` for MCP integration',
];

interface UseIdleTipsOptions {
  tips?: string[];
  idleTimeMs?: number;
}

export function useIdleTips({ tips = DEFAULT_TIPS, idleTimeMs = IDLE_TIME_MS }: UseIdleTipsOptions = {}) {
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>;
    let rotateTimer: ReturnType<typeof setInterval>;

    function resetIdle() {
      setShowTip(false);
      clearTimeout(idleTimer);
      clearInterval(rotateTimer);
      
      idleTimer = setTimeout(() => {
        setShowTip(true);
        setCurrentTipIndex(0);
        
        // Rotate tips every 5s
        rotateTimer = setInterval(() => {
          setCurrentTipIndex((prev) => (prev + 1) % tips.length);
        }, 5000);
      }, idleTimeMs);
    }

    // Listen for user interaction
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((event) => {
      window.addEventListener(event, resetIdle);
    });

    resetIdle();

    return () => {
      clearTimeout(idleTimer);
      clearInterval(rotateTimer);
      events.forEach((event) => {
        window.removeEventListener(event, resetIdle);
      });
    };
  }, [tips, idleTimeMs]);

  return {
    showTip,
    currentTip: tips[currentTipIndex] || tips[0],
  };
}

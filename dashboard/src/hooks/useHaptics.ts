import { useCallback } from 'react';

type HapticPattern = number | number[];

export function useHaptics() {
  const vibrate = useCallback((pattern: HapticPattern) => {
    if (!navigator.vibrate) return false;
    return navigator.vibrate(pattern);
  }, []);

  const approve = useCallback(() => vibrate([30]), [vibrate]);
  const reject = useCallback(() => vibrate([60, 30, 60]), [vibrate]);

  return { vibrate, approve, reject };
}

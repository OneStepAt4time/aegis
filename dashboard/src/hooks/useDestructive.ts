import { useCallback } from 'react';
import { useToastStore } from '../store/useToastStore';

export interface DestructiveOptions {
  label: string;
  onExecute: () => Promise<void>;
  onUndo?: () => Promise<void>;
  undoWindowMs?: number;
}

export function useDestructive(): {
  execute: (opts: DestructiveOptions) => void;
} {
  const addToast = useToastStore((s) => s.addToast);

  const execute = useCallback(
    (opts: DestructiveOptions) => {
      const { label, onExecute, onUndo, undoWindowMs = 5000 } = opts;

      let cancelled = false;

      const undoAction = onUndo
        ? () => {
            cancelled = true;
            void onUndo();
          }
        : undefined;

      addToast('undo', label, 'Click Undo to cancel', { undoAction, duration: undoWindowMs });

      setTimeout(() => {
        if (!cancelled) {
          void onExecute();
        }
      }, undoWindowMs);
    },
    [addToast],
  );

  return { execute };
}

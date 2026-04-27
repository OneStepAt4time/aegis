import { useEffect, useCallback } from 'react';

type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

interface Shortcut {
  key: string;
  description: string;
  modifier?: Modifier;
  /** Accept BOTH ctrl and meta (Cmd on Mac) for the same shortcut */
  allowMacCompat?: boolean;
  sequence?: string[];
  scope?: string;
}

export const SHORTCUTS: Shortcut[] = [
  { key: '?', modifier: 'shift', description: 'Show keyboard shortcuts' },
  { key: '/', modifier: 'meta', description: 'Show keyboard shortcuts (Mac)' },
  { key: 'k', modifier: 'ctrl', description: 'Focus search', allowMacCompat: true },
  { key: 'k', modifier: 'meta', description: 'Focus search (Mac)' },
  { key: 'n', modifier: 'ctrl', description: 'New session', allowMacCompat: true },
  { key: 'n', modifier: 'meta', description: 'New session (Mac)' },
  { key: 'g o', sequence: ['g', 'o'], description: 'Go to Overview' },
  { key: 'g s', sequence: ['g', 's'], description: 'Go to Sessions' },
  { key: 'g p', sequence: ['g', 'p'], description: 'Go to Pipelines' },
  { key: 'g a', sequence: ['g', 'a'], description: 'Go to Audit' },
  { key: 'g u', sequence: ['g', 'u'], description: 'Go to Users' },
  { key: 'Escape', description: 'Close modal / cancel' },
];

interface UseKeyboardShortcutsOptions {
  onShortcut?: (shortcut: Shortcut) => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onShortcut,
  enabled = true,
}: UseKeyboardShortcutsOptions = {}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      // Allow Escape always
      if (e.key !== 'Escape' && isInput) return;

      for (const shortcut of SHORTCUTS) {
        if (shortcut.sequence) continue;

        const keyMatch =
          e.key.toLowerCase() === shortcut.key.toLowerCase() ||
          (shortcut.key === 'Escape' && e.key === 'Escape');

        // Normal modifier check
        const normalModMatch =
          !shortcut.modifier ||
          (shortcut.modifier === 'ctrl' && e.ctrlKey) ||
          (shortcut.modifier === 'shift' && e.shiftKey) ||
          (shortcut.modifier === 'alt' && e.altKey) ||
          (shortcut.modifier === 'meta' && e.metaKey);

        // Mac compatibility: if shortcut allows Mac compat, accept both ctrl and meta
        const macModMatch = shortcut.allowMacCompat
          ? normalModMatch || (e.metaKey && shortcut.modifier === 'ctrl')
          : normalModMatch;

        if (keyMatch && macModMatch) {
          e.preventDefault();
          onShortcut?.(shortcut);
          return;
        }
      }
    },
    [enabled, onShortcut]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

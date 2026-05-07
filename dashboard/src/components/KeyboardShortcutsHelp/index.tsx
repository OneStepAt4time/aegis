import { useEffect, useState } from 'react';
import { X, Keyboard } from 'lucide-react';
import { SHORTCUTS } from '../../hooks/useKeyboardShortcuts';

export function KeyboardShortcutsHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) setVisible(true);
    else {
      const t = setTimeout(() => setVisible(false), 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
        open ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-void-lighter)]/60 bg-[var(--color-surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-[var(--color-accent-cyan)]" />
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-void-lighter)]/50 hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          {SHORTCUTS.filter(s => s.key !== 'Escape').map((shortcut) => (
            <div key={shortcut.key + (shortcut.modifier || '')} className="flex items-center justify-between py-1.5 border-b border-[var(--color-void-lighter)] last:border-0">
              <span className="text-sm text-[var(--color-text-muted)]">{shortcut.description}</span>
              <div className="flex items-center gap-1">
                {shortcut.modifier === 'ctrl' && (
                  <kbd className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-1.5 py-0.5 text-xs font-mono text-[var(--color-text-primary)]">Ctrl</kbd>
                )}
                {shortcut.modifier === 'shift' && (
                  <kbd className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-1.5 py-0.5 text-xs font-mono text-[var(--color-text-primary)]">Shift</kbd>
                )}
                <kbd className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-2 py-0.5 text-xs font-mono text-[var(--color-text-primary)]">
                  {shortcut.key === ' ' ? 'Space' : shortcut.key.toUpperCase()}
                </kbd>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-[var(--color-text-muted)]">
          Press <kbd className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-1 py-0.5 text-xs font-mono text-[var(--color-text-muted)]">?</kbd> or{' '}
          <kbd className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-1 py-0.5 text-xs font-mono text-[var(--color-text-muted)]">Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}

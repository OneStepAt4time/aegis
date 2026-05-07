/**
 * components/shared/KeyboardShortcutsBar.tsx — CCMeter-inspired keyboard shortcuts bar.
 *
 * Fixed bar at the bottom of the screen showing available keyboard shortcuts.
 * Only visible on desktop (hidden on mobile).
 * Uses CSS vars for all colors (light + dark mode).
 */

export interface ShortcutDef {
  keys: string[];
  label: string;
}

const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { keys: ['N'], label: 'New session' },
  { keys: ['⌘', 'K'], label: 'Command palette' },
  { keys: ['T'], label: 'Toggle theme' },
  { keys: ['?'], label: 'Show shortcuts' },
];

interface KeyboardShortcutsBarProps {
  shortcuts?: ShortcutDef[];
  className?: string;
}

export function KeyboardShortcutsBar({
  shortcuts = DEFAULT_SHORTCUTS,
  className = '',
}: KeyboardShortcutsBarProps) {
  return (
    <div
      className={`hidden md:flex items-center justify-center gap-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-2 text-[10px] text-[var(--color-text-muted)] ${className}`}
      role="contentinfo"
      aria-label="Keyboard shortcuts"
    >
      {shortcuts.map((shortcut, i) => (
        <span key={shortcut.label} className="flex items-center gap-1.5">
          {shortcut.keys.map((key, ki) => (
            <span key={ki}>
              <kbd className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-primary)]">
                {key}
              </kbd>
              {ki < shortcut.keys.length - 1 && (
                <span className="mx-0.5 text-[var(--color-text-muted)]" aria-hidden="true">+</span>
              )}
            </span>
          ))}
          <span className="ml-0.5">{shortcut.label}</span>
          {i < shortcuts.length - 1 && (
            <span className="ml-3 mr-0 h-3 w-px bg-[var(--color-void-lighter)]" aria-hidden="true" />
          )}
        </span>
      ))}
    </div>
  );
}

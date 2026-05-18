/**
 * components/shared/IsolationModeBadge.tsx — Isolation mode indicator.
 *
 * Shows a small badge indicating whether a session uses worktree isolation
 * or direct (none) mode.
 *
 * - worktree → green (safe, isolated)
 * - none     → amber warning (shared working copy)
 * - undefined → renders nothing (graceful degradation)
 *
 * Related: #3539 (bgIsolation), #3590 (backend field) // token-ok
 */

const MODE_STYLES: Record<string, { color: string; label: string; title: string }> = {
  worktree: {
    color: 'var(--color-success)',
    label: 'Worktree',
    title: 'Session uses isolated worktree (safe)',
  },
  none: {
    color: 'var(--color-warning)',
    label: 'Direct',
    title: 'Session edits working copy directly — concurrent sessions may conflict',
  },
};

export interface IsolationModeBadgeProps {
  /** Isolation mode. When undefined, renders nothing. */
  isolationMode?: string | null;
  className?: string;
}

export function IsolationModeBadge({ isolationMode, className = '' }: IsolationModeBadgeProps) {
  if (!isolationMode) return null;

  const style = MODE_STYLES[isolationMode] ?? {
    color: 'var(--color-text-muted)',
    label: isolationMode,
    title: `Isolation: ${isolationMode}`,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${className}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${style.color} 15%, transparent)`,
        color: style.color,
        border: `1px solid color-mix(in srgb, ${style.color} 30%, transparent)`,
      }}
      title={style.title}
    >
      {style.label}
    </span>
  );
}

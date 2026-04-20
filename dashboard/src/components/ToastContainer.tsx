/**
 * components/ToastContainer.tsx — Global toast notification renderer.
 *
 * - 6 s auto-dismiss; hover pauses dismiss timer
 * - Max 4 visible toasts (oldest evicted first, handled in store)
 * - aria-live="polite" on the toast region
 * - Colors via CSS vars: success=emerald, warning=amber, error=red, info=slate
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, CheckCircle, AlertTriangle, Info, AlertCircle, Trash2, Undo } from 'lucide-react';
import { useToastStore } from '../store/useToastStore';
import type { ToastType } from '../store/useToastStore';

const AUTO_DISMISS_MS = 6000;

const TYPE_STYLES: Record<ToastType, string> = {
  error: 'border-[var(--color-danger)]/40 bg-[var(--color-error-bg)]/90 text-[var(--color-danger)] ring-1 ring-[var(--color-danger)]/20',
  success: 'border-[var(--color-success)]/40 bg-[var(--color-success-bg)]/90 text-[var(--color-success)] ring-1 ring-[var(--color-success)]/20',
  info: 'border-[var(--color-void-lighter)]/60 bg-[var(--color-surface)]/90 text-[var(--color-text-muted)] ring-1 ring-[var(--color-void-lighter)]/20',
  warning: 'border-[var(--color-warning)]/40 bg-[var(--color-surface)]/90 text-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/20',
  undo: 'border-[var(--color-warning)]/40 bg-[var(--color-surface)]/90 text-[var(--color-warning)] ring-1 ring-[var(--color-warning)]/20',
};

const TYPE_ICONS: Record<ToastType, typeof CheckCircle> = {
  error: AlertCircle,
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
  undo: AlertTriangle,
};

function ToastItem({
  id,
  type,
  title,
  description,
  undoAction,
}: {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  undoAction?: () => void;
}) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [progress, setProgress] = useState(100);
  const Icon = TYPE_ICONS[type];

  const startRef = useRef(Date.now());
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const pausedRef = useRef(false);

  const startCountdown = useCallback(
    (remaining: number) => {
      startRef.current = Date.now();

      const tick = () => {
        if (pausedRef.current) return;
        const elapsed = Date.now() - startRef.current + elapsedRef.current;
        const pct = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
        setProgress(pct);
        if (pct > 0) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);

      timerRef.current = setTimeout(() => {
        removeToast(id);
      }, remaining);
    },
    [id, removeToast],
  );

  useEffect(() => {
    startCountdown(AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [startCountdown]);

  const handleMouseEnter = () => {
    pausedRef.current = true;
    elapsedRef.current += Date.now() - startRef.current;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const handleMouseLeave = () => {
    pausedRef.current = false;
    const remaining = AUTO_DISMISS_MS - elapsedRef.current;
    if (remaining > 0) {
      startCountdown(remaining);
    } else {
      removeToast(id);
    }
  };

  const handleUndo = () => {
    if (undoAction) {
      undoAction();
      removeToast(id);
    }
  };

  return (
    <div
      role="alert"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-in overflow-hidden ${TYPE_STYLES[type]}`}
    >
      {/* Progress bar */}
      <div
        className="absolute bottom-0 left-0 h-0.5 bg-current opacity-40 transition-none"
        style={{ width: `${progress}%` }}
        aria-hidden="true"
      />
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs opacity-70 leading-snug">{description}</p>
        )}
      </div>
      {undoAction && (
        <button
          onClick={handleUndo}
          className="shrink-0 flex items-center gap-1 rounded px-2 py-1 text-xs font-medium opacity-80 hover:opacity-100 transition-opacity bg-current/10"
          aria-label="Undo"
        >
          <Undo className="h-3 w-3" />
          Undo
        </button>
      )}
      <button
        onClick={() => removeToast(id)}
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {toasts.length > 1 && (
        <div className="flex justify-end pointer-events-auto">
          <button
            onClick={() => toasts.forEach((t) => removeToast(t.id))}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Dismiss all notifications"
          >
            <Trash2 className="h-3 w-3" />
            Clear all
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem
            id={t.id}
            type={t.type}
            title={t.title}
            description={t.description}
            undoAction={t.undoAction}
          />
        </div>
      ))}
    </div>
  );
}


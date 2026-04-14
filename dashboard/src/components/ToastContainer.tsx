/**
 * components/ToastContainer.tsx — Global toast notification renderer.
 */

import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, Info, AlertCircle, Trash2 } from 'lucide-react';
import { useToastStore } from '../store/useToastStore';
import type { ToastType } from '../store/useToastStore';

const TYPE_STYLES: Record<ToastType, string> = {
  error: 'border-red-500/50 bg-red-950/80 text-red-200',
  success: 'border-green-500/50 bg-green-950/80 text-green-200',
  info: 'border-cyan-500/50 bg-cyan-950/80 text-cyan-200',
  warning: 'border-yellow-500/50 bg-yellow-950/80 text-yellow-200',
};

const TYPE_ICONS: Record<ToastType, typeof CheckCircle> = {
  error: AlertCircle,
  success: CheckCircle,
  info: Info,
  warning: AlertTriangle,
};

const AUTO_DISMISS_MS = 4000;

function ToastItem({ id, type, title, description }: { id: string; type: ToastType; title: string; description?: string }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [progress, setProgress] = useState(100);
  const Icon = TYPE_ICONS[type];

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [id]);

  return (
    <div
      role="alert"
      className={`relative flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-in overflow-hidden ${TYPE_STYLES[type]}`}
    >
      {/* Progress bar */}
      <div
        className="absolute bottom-0 left-0 h-0.5 bg-current opacity-30 transition-none"
        style={{ width: `${progress}%` }}
      />
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs opacity-80">{description}</p>}
      </div>
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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.length > 1 && (
        <div className="flex justify-end pointer-events-auto">
          <button
            onClick={() => toasts.forEach((t) => removeToast(t.id))}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Dismiss all notifications"
          >
            <Trash2 className="h-3 w-3" />
            Clear all
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem id={t.id} type={t.type} title={t.title} description={t.description} />
        </div>
      ))}
    </div>
  );
}

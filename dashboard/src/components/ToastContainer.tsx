/**
 * components/ToastContainer.tsx — Global toast notification renderer.
 */

import { X } from 'lucide-react';
import { useToastStore } from '../store/useToastStore';
import type { ToastType } from '../store/useToastStore';

const TYPE_STYLES: Record<ToastType, string> = {
  error: 'border-red-500/50 bg-red-950/80 text-red-200',
  success: 'border-green-500/50 bg-green-950/80 text-green-200',
  info: 'border-cyan-500/50 bg-cyan-950/80 text-cyan-200',
  warning: 'border-yellow-500/50 bg-yellow-950/80 text-yellow-200',
};

function ToastItem({ id, type, title, description }: { id: string; type: ToastType; title: string; description?: string }) {
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-in ${TYPE_STYLES[type]}`}
    >
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

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem id={t.id} type={t.type} title={t.title} description={t.description} />
        </div>
      ))}
    </div>
  );
}

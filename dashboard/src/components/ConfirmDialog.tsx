/**
 * components/ConfirmDialog.tsx — Reusable confirmation modal dialog.
 */

import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT_STYLES = {
  danger: {
    confirm:
      'bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30',
  },
  warning: {
    confirm:
      'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30',
  },
  default: {
    confirm:
      'bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/30',
  },
} as const;

const FOCUSABLE_SELECTOR =
  'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = 'confirm-dialog-title';

  // Auto-focus the confirm button when opened
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => confirmRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  // Escape to cancel
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    if (!modal) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    modal.addEventListener('keydown', handler);
    return () => modal.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  const styles = VARIANT_STYLES[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-sm mx-4 bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg shadow-2xl"
      >
        <div className="p-4 sm:p-5 space-y-4">
          <h2
            id={titleId}
            className="text-sm font-semibold text-gray-100"
          >
            {title}
          </h2>
          <p className="text-sm text-gray-400">{message}</p>
        </div>

        <div className="flex gap-2 px-4 sm:px-5 pb-4 sm:pb-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-300 hover:text-gray-100 hover:border-[#333] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`flex-1 min-h-[44px] px-3 py-2 text-xs font-medium rounded transition-colors ${styles.confirm}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * components/SaveTemplateModal.tsx — Modal dialog for saving a session as a template.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { createTemplate } from '../api/client';
import { useToastStore } from '../store/useToastStore';

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}

export default function SaveTemplateModal({ open, onClose, sessionId }: SaveTemplateModalProps) {
  const abortRef = useRef<AbortController | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((t) => t.addToast);

  const handleClose = useCallback((): void => {
    setName('');
    setDescription('');
    setError(null);
    setLoading(false);
    onClose();
  }, [onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        abortRef.current?.abort();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    if (!modal) return;

    const FOCUSABLE_SELECTOR = 'input, textarea, button, [tabindex]:not([tabindex="-1"])';

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Template name is required');
      return;
    }

    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await createTemplate({
        name: name.trim(),
        description: description.trim() || undefined,
        sessionId,
      });
      addToast('success', 'Template saved', `"${name.trim()}" created successfully`);
      handleClose();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Save session as template"
        className="relative w-full max-w-md mx-4 bg-[#111118] border border-[#1a1a2e] rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[#1a1a2e]">
          <h2 className="text-sm font-semibold text-gray-100">Save as Template</h2>
          <button
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {error && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="template-name" className="block text-xs font-medium text-gray-300 mb-1.5">
              Template Name *
            </label>
            <input
              id="template-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My template name"
              className="w-full px-3 py-2 text-sm rounded bg-[#0a0a0f] border border-[#1a1a2e] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] transition-colors"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="template-desc" className="block text-xs font-medium text-gray-300 mb-1.5">
              Description (optional)
            </label>
            <textarea
              id="template-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this template for?"
              rows={3}
              className="w-full px-3 py-2 text-sm rounded bg-[#0a0a0f] border border-[#1a1a2e] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] transition-colors resize-none"
              disabled={loading}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="flex-1 px-3 py-2 text-xs font-medium rounded bg-[#0a0a0f] border border-[#1a1a2e] text-gray-300 hover:text-gray-100 hover:border-[#333] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-3 py-2 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Template'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

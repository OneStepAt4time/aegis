/**
 * components/TemplateModal.tsx — Modal dialog for creating and editing session templates.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { X, Loader2 } from 'lucide-react';
import { createTemplate, updateTemplate } from '../api/client';
import type { SessionTemplate } from '../types';
import { useToastStore } from '../store/useToastStore';

const PERMISSION_MODES = [
  { value: '', label: 'Default (prompt)' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'dontAsk', label: "Don't Ask" },
  { value: 'auto', label: 'Auto-accept' },
];

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  /** Provide a template to edit; omit to create a new one. */
  template?: SessionTemplate | null;
  /** Called after successful create or update. */
  onSaved: () => void;
}

export default function TemplateModal({ open, onClose, template, onSaved }: TemplateModalProps) {
  const abortRef = useRef<AbortController | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap(open);

  const isEditing = template != null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [prompt, setPrompt] = useState('');
  const [claudeCommand, setClaudeCommand] = useState('');
  const [permissionMode, setPermissionMode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((t) => t.addToast);

  // Populate fields when editing
  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setDescription(template.description ?? '');
      setWorkDir(template.workDir);
      setPrompt(template.prompt ?? '');
      setClaudeCommand(template.claudeCommand ?? '');
      setPermissionMode(template.permissionMode ?? '');
    } else {
      setName('');
      setDescription('');
      setWorkDir('');
      setPrompt('');
      setClaudeCommand('');
      setPermissionMode('');
    }
    setError(null);
    setLoading(false);
  }, [open, template]);



  const handleClose = useCallback((): void => {
    abortRef.current?.abort();
    setError(null);
    setLoading(false);
    onClose();
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose]);



  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Template name is required');
      return;
    }

    const trimmedWorkDir = workDir.trim();
    if (!isEditing && !trimmedWorkDir) {
      setError('Work directory is required');
      return;
    }

    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const payload = {
      name: trimmedName,
      description: description.trim() || undefined,
      workDir: trimmedWorkDir || undefined,
      prompt: prompt.trim() || undefined,
      claudeCommand: claudeCommand.trim() || undefined,
      permissionMode: permissionMode || undefined,
    };

    try {
      if (isEditing && template) {
        await updateTemplate(template.id, payload);
        addToast('success', 'Template updated', `"${trimmedName}" saved`);
      } else {
        await createTemplate(payload);
        addToast('success', 'Template created', `"${trimmedName}" created`);
      }
      onSaved();
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
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? 'Edit template' : 'Create template'}
        className="relative w-full max-w-lg mx-4 bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--color-void-lighter)]">
          <h2 className="text-sm font-semibold text-gray-100">
            {isEditing ? 'Edit Template' : 'Create Template'}
          </h2>
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
            <label htmlFor="tmpl-name" className="block text-xs font-medium text-gray-300 mb-1.5">
              Name *
            </label>
            <input
              ref={nameInputRef}
              id="tmpl-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. React scaffold"
              className="w-full px-3 py-2 text-sm rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="tmpl-desc" className="block text-xs font-medium text-gray-300 mb-1.5">
              Description
            </label>
            <textarea
              id="tmpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this template for?"
              rows={2}
              className="w-full px-3 py-2 text-sm rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors resize-none"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="tmpl-workdir" className="block text-xs font-medium text-gray-300 mb-1.5">
              Work Directory {!isEditing && '*'}
            </label>
            <input
              id="tmpl-workdir"
              type="text"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="/home/user/project"
              className="w-full px-3 py-2 text-sm rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors font-mono"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="tmpl-prompt" className="block text-xs font-medium text-gray-300 mb-1.5">
              Initial Prompt
            </label>
            <textarea
              id="tmpl-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="First message to send Claude Code"
              rows={3}
              className="w-full px-3 py-2 text-sm rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors resize-none"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="tmpl-command" className="block text-xs font-medium text-gray-300 mb-1.5">
              Claude Command
            </label>
            <input
              id="tmpl-command"
              type="text"
              value={claudeCommand}
              onChange={(e) => setClaudeCommand(e.target.value)}
              placeholder="e.g. claude --model opus"
              className="w-full px-3 py-2 text-sm rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors font-mono"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="tmpl-perm" className="block text-xs font-medium text-gray-300 mb-1.5">
              Permission Mode
            </label>
            <select
              id="tmpl-perm"
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-100 focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors"
              disabled={loading}
            >
              {PERMISSION_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[var(--color-void)] border border-[var(--color-void-lighter)] text-gray-300 hover:text-gray-100 hover:border-[#333] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[var(--color-accent-cyan)]/10 hover:bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)] border border-[var(--color-accent-cyan)]/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                isEditing ? 'Save Changes' : 'Create Template'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * components/CreateSessionModal.tsx â€” Modal dialog for creating new sessions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Plus, Trash2 } from 'lucide-react';
import { createSession, batchCreateSessions, getTemplates } from '../api/client';
import type { SessionTemplate } from '../types';

interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
}

type BatchRow = { workDir: string; name: string; prompt: string; _key: number };
let nextKey = 0;
function makeRow(): BatchRow {
  return { workDir: '', name: '', prompt: '', _key: nextKey++ };
}

export default function CreateSessionModal({ open, onClose }: CreateSessionModalProps) {
  const navigate = useNavigate();
  const workDirRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleClose = useCallback((): void => {
    resetForm();
    onClose();
  }, [onClose]);

  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key â€” abort in-flight request
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

  // Focus trap â€” Tab/Shift+Tab cycles within the modal (#246)
  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    if (!modal) return;

    const FOCUSABLE_SELECTOR = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';

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

  // Focus first input when modal opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure the modal is rendered
      const t = setTimeout(() => workDirRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Load templates
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTemplatesLoading(true);
    getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoading(false));
  }, [open]);

  const [workDir, setWorkDir] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<'single' | 'batch' | 'template'>('single');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [batchRows, setBatchRows] = useState<BatchRow[]>([makeRow(), makeRow()]);
  const [sharedPrompt, setSharedPrompt] = useState('');
  const [batchResult, setBatchResult] = useState<{
    sessions: Array<{ id: string; name: string }>;
    created: number;
    failed: number;
    errors: string[];
  } | null>(null);

  function resetForm(): void {
    setWorkDir('');
    setName('');
    setPrompt('');
    setPermissionMode('default');
    setLoading(false);
    setError(null);
    setBatchRows([makeRow(), makeRow()]);
    setSharedPrompt('');
    setBatchResult(null);
    setMode('single');
    setSelectedTemplateId('');
  }

  function addBatchRow(): void {
    if (batchRows.length >= 10) return;
    setBatchRows([...batchRows, makeRow()]);
  }

  function removeBatchRow(index: number): void {
    if (batchRows.length <= 1) return;
    setBatchRows(batchRows.filter((_, i) => i !== index));
  }

  function updateBatchRow(index: number, field: keyof BatchRow, value: string): void {
    setBatchRows(batchRows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  async function handleBatchSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBatchResult(null);

    const validRows = batchRows.filter((r) => r.workDir.trim());
    if (validRows.length === 0) {
      setError('At least one working directory is required');
      return;
    }

    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await batchCreateSessions({
        sessions: validRows.map((row) => ({
          workDir: row.workDir.trim(),
          name: row.name.trim() || undefined,
          prompt: (row.prompt.trim() || sharedPrompt.trim()) || undefined,
          permissionMode,
        })),
        signal: controller.signal,
      });
      setBatchResult(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to create sessions');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!workDir.trim()) {
      setError('Working directory is required');
      return;
    }

    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const session = await createSession({
        workDir: workDir.trim(),
        name: name.trim() || undefined,
        prompt: prompt.trim() || undefined,
        permissionMode,
        signal: controller.signal,
      });
      resetForm();
      onClose();
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Create new session" className={`relative w-full ${mode === 'batch' ? 'max-w-2xl' : 'max-w-md'} mx-4 bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--color-void-lighter)]">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">New Session</h2>
            <div className="flex rounded bg-[var(--color-void)] p-0.5">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  mode === 'single'
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => setMode('batch')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  mode === 'batch'
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                Batch
              </button>
              {templates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMode('template')}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    mode === 'template'
                      ? 'bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  Template
                </button>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Single mode form */}
        {mode === 'single' && (
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {/* Work Dir */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
              Working Directory <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              type="text"
              ref={workDirRef}
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="/home/user/project"
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent)] font-mono"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
              Session Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-session"
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
              Initial Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Fix the login bug..."
              rows={3}
              className="w-full min-h-[88px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent)] resize-none"
            />
          </div>

          {/* Permission mode */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Permission Mode
            </label>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="default">default - asks for everything</option>
              <option value="plan">plan - auto-reads, asks for writes</option>
              <option value="acceptEdits">acceptEdits - auto-edits, asks for bash</option>
              <option value="bypassPermissions">bypassPermissions - never asks</option>
              <option value="auto">auto - auto-approve in sandbox</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[var(--color-error)] bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[var(--color-void-lighter)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !workDir.trim()}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded bg-[var(--color-cta-bg)] hover:bg-[var(--color-cta-bg-hover)] text-[var(--color-cta-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Create Session
            </button>
          </div>
        </form>
        )}

        {/* Batch mode form */}
        {mode === 'batch' && !batchResult && (
        <form onSubmit={handleBatchSubmit} className="p-4 sm:p-5 space-y-4">
          {/* Shared prompt */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
              Shared Prompt
            </label>
            <textarea
              value={sharedPrompt}
              onChange={(e) => setSharedPrompt(e.target.value)}
              placeholder="Apply to all sessions without a per-row prompt..."
              rows={2}
              className="w-full min-h-[88px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent)] resize-none"
            />
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_120px_1fr_44px] gap-2 text-xs font-medium text-[var(--color-text-muted)] px-1">
            <span>Working Directory <span className="text-[var(--color-error)]">*</span></span>
            <span>Name</span>
            <span>Prompt (override)</span>
            <span />
          </div>

          {/* Batch rows */}
          <div className="space-y-2">
            {batchRows.map((row, i) => (
              <div key={row._key} className="grid grid-cols-[1fr_120px_1fr_44px] gap-2 items-start">
                <input
                  type="text"
                  value={row.workDir}
                  onChange={(e) => updateBatchRow(i, 'workDir', e.target.value)}
                  placeholder="/home/user/project"
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent)] font-mono"
                />
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateBatchRow(i, 'name', e.target.value)}
                  placeholder="name"
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent)]"
                />
                <input
                  type="text"
                  value={row.prompt}
                  onChange={(e) => updateBatchRow(i, 'prompt', e.target.value)}
                  placeholder="Override prompt..."
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  type="button"
                  onClick={() => removeBatchRow(i)}
                  disabled={batchRows.length <= 1}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-[var(--color-error)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add row button */}
          {batchRows.length < 10 && (
            <button
              type="button"
              onClick={addBatchRow}
              className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add session
            </button>
          )}

          {/* Permission mode */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
              Permission Mode
            </label>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="default">default - asks for everything</option>
              <option value="plan">plan - auto-reads, asks for writes</option>
              <option value="acceptEdits">acceptEdits - auto-edits, asks for bash</option>
              <option value="bypassPermissions">bypassPermissions - never asks</option>
              <option value="auto">auto - auto-approve in sandbox</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[var(--color-error)] bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[var(--color-void-lighter)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !batchRows.some((r) => r.workDir.trim())}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded bg-[var(--color-cta-bg)] hover:bg-[var(--color-cta-bg-hover)] text-[var(--color-cta-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Create {batchRows.filter((r) => r.workDir.trim()).length} Session(s)
            </button>
          </div>
        </form>
        )}

        {/* Template mode form */}
        {mode === 'template' && (
        <form onSubmit={async (e) => {
          e.preventDefault();
          setError(null);

          const template = templates.find(t => t.id === selectedTemplateId);
          if (!template) {
            setError('Please select a template');
            return;
          }

          setLoading(true);
          abortRef.current?.abort();
          const controller = new AbortController();
          abortRef.current = controller;

          try {
            const session = await createSession({
              workDir: template.workDir,
              prompt: template.prompt,
              claudeCommand: template.claudeCommand,
              env: template.env,
              stallThresholdMs: template.stallThresholdMs,
              permissionMode: template.permissionMode,
              autoApprove: template.autoApprove,
              signal: controller.signal,
            });
            resetForm();
            onClose();
            navigate(`/sessions/${session.id}`);
          } catch (err) {
            if (controller.signal.aborted) return;
            setError(err instanceof Error ? err.message : 'Failed to create session from template');
          } finally {
            if (abortRef.current === controller) {
              abortRef.current = null;
              setLoading(false);
            }
          }
        }} className="p-4 sm:p-5 space-y-4">
          {/* Template selection */}
          <div>
            <label htmlFor="template-select" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
              Select Template
            </label>
            {templatesLoading ? (
              <div className="text-xs text-[var(--color-text-muted)] italic">Loading templates…</div>
            ) : templates.length === 0 ? (
              <div className="text-xs text-[var(--color-text-muted)] italic">No templates available</div>
            ) : (
              <select
                id="template-select"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-cyan)]"
              >
                <option value="">— Choose a template —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.description ? `— ${t.description}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Template summary */}
          {selectedTemplateId && templates.find(t => t.id === selectedTemplateId) && (() => {
            const t = templates.find(t => t.id === selectedTemplateId)!;
            return (
              <div className="text-xs space-y-1 p-3 bg-[var(--color-void)] rounded border border-[var(--color-void-lighter)]">
                <div className="text-[var(--color-text-muted)]">
                  <strong>WorkDir:</strong> <span className="font-mono text-[var(--color-text-muted)]">{t.workDir}</span>
                </div>
                {t.stallThresholdMs && (
                  <div className="text-[var(--color-text-muted)]">
                    <strong>Stall Threshold:</strong> <span className="text-[var(--color-text-muted)]">{t.stallThresholdMs}ms</span>
                  </div>
                )}
                {t.permissionMode && t.permissionMode !== 'default' && (
                  <div className="text-[var(--color-text-muted)]">
                    <strong>Permission Mode:</strong> <span className="text-[var(--color-text-muted)]">{t.permissionMode}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[var(--color-void-lighter)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedTemplateId}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded bg-[var(--color-cta-bg)] hover:bg-[var(--color-cta-bg-hover)] text-[var(--color-cta-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Create from Template
            </button>
          </div>
        </form>
        )}

        {/* Batch results */}
        {batchResult && (
        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-3">
            {batchResult.created > 0 && (
              <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-3 py-1.5">
                {batchResult.created} created
              </span>
            )}
            {batchResult.failed > 0 && (
              <span className="text-xs font-medium text-[var(--color-error)] bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded px-3 py-1.5">
                {batchResult.failed} failed
              </span>
            )}
          </div>

          {batchResult.sessions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Created sessions</p>
              <ul className="space-y-1">
                {batchResult.sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => { handleClose(); navigate(`/sessions/${s.id}`); }}
                      className="text-xs text-[var(--color-accent)] hover:underline font-mono"
                    >
                      {s.id.slice(0, 8)}...{s.name ? ` - ${s.name}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {batchResult.errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Errors</p>
              <ul className="space-y-1">
                {batchResult.errors.map((err, i) => (
                  <li key={i} className="text-xs text-[var(--color-error)]">{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[var(--color-void-lighter)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}


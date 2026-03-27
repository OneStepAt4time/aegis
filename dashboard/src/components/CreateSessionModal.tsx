/**
 * components/CreateSessionModal.tsx — Modal dialog for creating new sessions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Plus, Trash2 } from 'lucide-react';
import { createSession, batchCreateSessions } from '../api/client';

interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
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

  // Close on Escape key — abort in-flight request
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

  // Focus trap — Tab/Shift+Tab cycles within the modal (#246)
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

  const [workDir, setWorkDir] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type BatchRow = { workDir: string; name: string; prompt: string; _key: number };
  let nextKey = 0;
  function makeRow(): BatchRow {
    return { workDir: '', name: '', prompt: '', _key: nextKey++ };
  }

  const [mode, setMode] = useState<'single' | 'batch'>('single');
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
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Create new session" className={`relative w-full ${mode === 'batch' ? 'max-w-2xl' : 'max-w-md'} mx-4 bg-[#111118] border border-[#1a1a2e] rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[#1a1a2e]">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-semibold text-gray-100">New Session</h2>
            <div className="flex rounded bg-[#0a0a0f] p-0.5">
              <button
                type="button"
                onClick={() => setMode('single')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  mode === 'single'
                    ? 'bg-[#00e5ff]/10 text-[#00e5ff]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => setMode('batch')}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  mode === 'batch'
                    ? 'bg-[#00e5ff]/10 text-[#00e5ff]'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                Batch
              </button>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Single mode form */}
        {mode === 'single' && (
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {/* Work Dir */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Working Directory <span className="text-[#ff3366]">*</span>
            </label>
            <input
              type="text"
              ref={workDirRef}
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="/home/user/project"
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] font-mono"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Session Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-session"
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff]"
            />
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Initial Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Fix the login bug..."
              rows={3}
              className="w-full min-h-[88px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] resize-none"
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
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 focus:outline-none focus:border-[#00e5ff]"
            >
              <option value="default">default — asks for everything</option>
              <option value="plan">plan — auto-reads, asks for writes</option>
              <option value="acceptEdits">acceptEdits — auto-edits, asks for bash</option>
              <option value="bypassPermissions">bypassPermissions — never asks</option>
              <option value="auto">auto — auto-approve in sandbox</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[#ff3366] bg-[#ff3366]/10 border border-[#ff3366]/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !workDir.trim()}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Shared Prompt
            </label>
            <textarea
              value={sharedPrompt}
              onChange={(e) => setSharedPrompt(e.target.value)}
              placeholder="Apply to all sessions without a per-row prompt..."
              rows={2}
              className="w-full min-h-[88px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] resize-none"
            />
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_120px_1fr_44px] gap-2 text-xs font-medium text-gray-500 px-1">
            <span>Working Directory <span className="text-[#ff3366]">*</span></span>
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
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] font-mono"
                />
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateBatchRow(i, 'name', e.target.value)}
                  placeholder="name"
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff]"
                />
                <input
                  type="text"
                  value={row.prompt}
                  onChange={(e) => updateBatchRow(i, 'prompt', e.target.value)}
                  placeholder="Override prompt..."
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff]"
                />
                <button
                  type="button"
                  onClick={() => removeBatchRow(i)}
                  disabled={batchRows.length <= 1}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-[#ff3366] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add session
            </button>
          )}

          {/* Permission mode */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Permission Mode
            </label>
            <select
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 focus:outline-none focus:border-[#00e5ff]"
            >
              <option value="default">default — asks for everything</option>
              <option value="plan">plan — auto-reads, asks for writes</option>
              <option value="acceptEdits">acceptEdits — auto-edits, asks for bash</option>
              <option value="bypassPermissions">bypassPermissions — never asks</option>
              <option value="auto">auto — auto-approve in sandbox</option>
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-[#ff3366] bg-[#ff3366]/10 border border-[#ff3366]/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !batchRows.some((r) => r.workDir.trim())}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Create {batchRows.filter((r) => r.workDir.trim()).length} Session(s)
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
              <span className="text-xs font-medium text-[#ff3366] bg-[#ff3366]/10 border border-[#ff3366]/20 rounded px-3 py-1.5">
                {batchResult.failed} failed
              </span>
            )}
          </div>

          {batchResult.sessions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-400">Created sessions</p>
              <ul className="space-y-1">
                {batchResult.sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => { handleClose(); navigate(`/sessions/${s.id}`); }}
                      className="text-xs text-[#00e5ff] hover:underline font-mono"
                    >
                      {s.id.slice(0, 8)}...{s.name ? ` — ${s.name}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {batchResult.errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-400">Errors</p>
              <ul className="space-y-1">
                {batchResult.errors.map((err, i) => (
                  <li key={i} className="text-xs text-[#ff3366]">{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 transition-colors"
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

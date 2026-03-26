/**
 * components/CreateSessionModal.tsx — Modal dialog for creating new sessions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2 } from 'lucide-react';
import { createSession } from '../api/client';

interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreateSessionModal({ open, onClose }: CreateSessionModalProps) {
  const navigate = useNavigate();
  const workDirRef = useRef<HTMLInputElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function resetForm(): void {
    setWorkDir('');
    setName('');
    setPrompt('');
    setPermissionMode('default');
    setLoading(false);
    setError(null);
  }

  function handleClose(): void {
    resetForm();
    onClose();
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
    try {
      const session = await createSession({
        workDir: workDir.trim(),
        name: name.trim() || undefined,
        prompt: prompt.trim() || undefined,
        permissionMode,
      });
      resetForm();
      onClose();
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
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
      <div role="dialog" aria-modal="true" aria-label="Create new session" className="relative w-full max-w-md mx-4 bg-[#111118] border border-[#1a1a2e] rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[#1a1a2e]">
          <h2 className="text-sm font-semibold text-gray-100">New Session</h2>
          <button
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
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
              autoFocus
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
      </div>
    </div>
  );
}

/**
 * components/NewSessionDrawer.tsx — Right-side drawer for creating a new session.
 * Opens via ⌘N, header + button, or programmatic openNewSession().
 * Width: 480px desktop, full-width mobile.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { createSession, getTemplates } from '../api/client';
import type { SessionTemplate } from '../types';
import { useToastStore } from '../store/useToastStore';
import { useDrawerStore } from '../store/useDrawerStore';

const PERMISSION_MODES = [
  { value: 'default', label: 'Default (prompt)' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
  { value: 'clipboardOnly', label: 'Clipboard Only' },
];

export function NewSessionDrawer() {
  const navigate = useNavigate();
  const addToast = useToastStore((t) => t.addToast);
  const { newSessionOpen, closeNewSession } = useDrawerStore();

  const [name, setName] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [claudeCommand, setClaudeCommand] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);

  const firstInputRef = useRef<HTMLInputElement>(null);

  // Load templates when drawer opens
  useEffect(() => {
    if (!newSessionOpen) return;
    let cancelled = false;
    getTemplates()
      .then((t) => { if (!cancelled) setTemplates(t); })
      .catch(() => { if (!cancelled) setTemplates([]); });
    return () => { cancelled = true; };
  }, [newSessionOpen]);

  // Focus first input when drawer opens
  useEffect(() => {
    if (newSessionOpen) {
      setTimeout(() => firstInputRef.current?.focus(), 80);
    } else {
      // Reset form on close
      setName('');
      setWorkDir('');
      setClaudeCommand('');
      setPrompt('');
      setPermissionMode('default');
    }
  }, [newSessionOpen]);

  // Esc closes the drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && newSessionOpen) {
        e.stopPropagation();
        closeNewSession();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [newSessionOpen, closeNewSession]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workDir.trim()) {
      addToast('error', 'Missing work directory', 'Work directory is required');
      return;
    }

    setLoading(true);
    try {
      const session = await createSession({
        workDir: workDir.trim(),
        name: name.trim() || undefined,
        claudeCommand: claudeCommand.trim() || undefined,
        prompt: prompt.trim() || undefined,
        permissionMode: permissionMode !== 'default' ? permissionMode : undefined,
      });
      addToast('success', 'Session created', session.id);
      closeNewSession();
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create session';
      addToast('error', 'Creation failed', msg);
    } finally {
      setLoading(false);
    }
  }, [workDir, name, claudeCommand, prompt, permissionMode, addToast, navigate, closeNewSession]);

  return (
    <AnimatePresence>
      {newSessionOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm"
            onClick={closeNewSession}
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <motion.aside
            key="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="New Session"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed right-0 top-0 bottom-0 z-[151] w-full md:w-[480px] bg-[var(--color-surface,#1e2433)] border-l border-white/5 shadow-2xl flex flex-col overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text,#F8FAFC)]">New Session</h2>
                <p className="text-xs text-gray-400 mt-0.5">Create a new Aegis agent session</p>
              </div>
              <button
                type="button"
                onClick={closeNewSession}
                aria-label="Close drawer"
                className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-gray-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-6 flex-1">
              {/* Work Directory */}
              <div>
                <label htmlFor="drawer-workDir" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Working Directory <span className="text-red-400">*</span>
                </label>
                <input
                  ref={firstInputRef}
                  id="drawer-workDir"
                  type="text"
                  value={workDir}
                  onChange={(e) => setWorkDir(e.target.value)}
                  placeholder="/home/user/projects/myapp"
                  required
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
                />
                <p className="mt-1 text-xs text-gray-500">Absolute path where the session will run</p>
              </div>

              {/* Session Name */}
              <div>
                <label htmlFor="drawer-name" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Session Name <span className="text-gray-500">(optional)</span>
                </label>
                <input
                  id="drawer-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-session"
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
                />
              </div>

              {/* Claude Command */}
              <div>
                <label htmlFor="drawer-claudeCommand" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Claude Command <span className="text-gray-500">(optional)</span>
                </label>
                <input
                  id="drawer-claudeCommand"
                  type="text"
                  value={claudeCommand}
                  onChange={(e) => setClaudeCommand(e.target.value)}
                  placeholder="claude --print"
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
                />
                <p className="mt-1 text-xs text-gray-500">Default: claude --print</p>
              </div>

              {/* Initial Prompt */}
              <div>
                <label htmlFor="drawer-prompt" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Initial Prompt <span className="text-gray-500">(optional)</span>
                </label>
                <textarea
                  id="drawer-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="What do you want to accomplish?"
                  rows={3}
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)] resize-y"
                />
              </div>

              {/* Permission Mode */}
              <div>
                <label htmlFor="drawer-permissionMode" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Permission Mode
                </label>
                <select
                  id="drawer-permissionMode"
                  value={permissionMode}
                  onChange={(e) => setPermissionMode(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-[var(--color-accent-cyan)]"
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {templates.length > 0 && (
                <p className="text-xs text-gray-500">
                  {templates.length} template{templates.length !== 1 ? 's' : ''} available — use the Overview page to create from template
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2 mt-auto">
                <button
                  type="submit"
                  disabled={loading || !workDir.trim()}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded bg-[var(--color-cta,#22C55E)] hover:opacity-90 disabled:opacity-50 text-[var(--color-void,#0F172A)] transition-opacity"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {loading ? 'Creating…' : 'Create Session'}
                </button>
                <button
                  type="button"
                  onClick={closeNewSession}
                  className="px-4 py-2.5 text-sm font-medium rounded border border-[var(--color-void-lighter)] text-gray-300 hover:bg-[var(--color-void-lighter)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

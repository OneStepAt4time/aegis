/**
 * pages/NewSessionPage.tsx — Standalone session creation page.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, ArrowLeft } from 'lucide-react';
import { createSession, getTemplates } from '../api/client';
import type { SessionTemplate } from '../types';
import { useToastStore } from '../store/useToastStore';

const PERMISSION_MODES = [
  { value: 'default', label: 'Default (prompt)' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
  { value: 'clipboardOnly', label: 'Clipboard Only' },
];

export default function NewSessionPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((t) => t.addToast);

  const [name, setName] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [claudeCommand, setClaudeCommand] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  

  // Load templates on mount
  useState(() => {
    getTemplates()
      .then((t) => setTemplates(t))
      .catch(() => {});
  });

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
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create session';
      addToast('error', 'Creation failed', msg);
    } finally {
      setLoading(false);
    }
  }, [workDir, name, claudeCommand, prompt, permissionMode, addToast, navigate]);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded hover:bg-[var(--color-void-lighter)] transition-colors text-gray-400 hover:text-gray-200"
          title="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-100">New Session</h1>
          <p className="mt-1 text-sm text-gray-500">Create a new Aegis session</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Work Directory */}
        <div>
          <label htmlFor="workDir" className="block text-sm font-medium text-gray-300 mb-1.5">
            Working Directory <span className="text-red-400">*</span>
          </label>
          <input
            id="workDir"
            type="text"
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="/home/user/projects/myapp"
            required
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
          />
          <p className="mt-1 text-xs text-gray-500">Absolute path where the session will run</p>
        </div>

        {/* Session Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-1.5">
            Session Name <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-session"
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
          />
        </div>

        {/* Claude Command */}
        <div>
          <label htmlFor="claudeCommand" className="block text-sm font-medium text-gray-300 mb-1.5">
            Claude Command <span className="text-gray-500">(optional)</span>
          </label>
          <input
            id="claudeCommand"
            type="text"
            value={claudeCommand}
            onChange={(e) => setClaudeCommand(e.target.value)}
            placeholder="claude --print"
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
          />
          <p className="mt-1 text-xs text-gray-500">Default: claude --print</p>
        </div>

        {/* Initial Prompt */}
        <div>
          <label htmlFor="prompt" className="block text-sm font-medium text-gray-300 mb-1.5">
            Initial Prompt <span className="text-gray-500">(optional)</span>
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What do you want to accomplish?"
            rows={3}
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)] resize-y"
          />
        </div>

        {/* Permission Mode */}
        <div>
          <label htmlFor="permissionMode" className="block text-sm font-medium text-gray-300 mb-1.5">
            Permission Mode
          </label>
          <select
            id="permissionMode"
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-[var(--color-accent-cyan)]"
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Templates hint */}
        {templates.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">
              {templates.length} template{templates.length !== 1 ? 's' : ''} available — use the Overview page to create from template
            </p>
          </div>
        )}

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading || !workDir.trim()}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded bg-[var(--color-accent-cyan)] hover:opacity-90 disabled:opacity-50 text-[var(--color-void)] transition-opacity"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {loading ? 'Creating…' : 'Create Session'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2.5 text-sm font-medium rounded border border-[var(--color-void-lighter)] text-gray-300 hover:bg-[var(--color-void-lighter)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

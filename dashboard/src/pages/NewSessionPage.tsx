/**
 * pages/NewSessionPage.tsx — Standalone session creation page.
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2, Plus, ArrowLeft, Star, Clock, X } from 'lucide-react';
import { createSession, getTemplates } from '../api/client';
import type { SessionTemplate } from '../types';
import { useToastStore } from '../store/useToastStore';
import { useRecentDirs } from '../hooks/useRecentDirs';
import { sanitizeErrorMessage } from '../utils/sanitizeErrorMessage';

const PERMISSION_MODES = [
  { value: 'default', label: 'Default (prompt)' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
  { value: 'clipboardOnly', label: 'Clipboard Only' },
];

export default function NewSessionPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((t) => t.addToast);
  const { recent, starred, add: addRecentDir, toggleStar, remove: removeRecentDir } = useRecentDirs();

  const [name, setName] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [claudeCommand, setClaudeCommand] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  

  useEffect(() => {
    let cancelled = false;

    getTemplates()
      .then((t) => {
        if (!cancelled) {
          setTemplates(t);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
      addRecentDir(workDir.trim());
      addToast('success', 'Session created', session.id);
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      const msg = sanitizeErrorMessage(err, 'Failed to create session');
      addToast('error', 'Creation failed', msg);
    } finally {
      setLoading(false);
    }
  }, [workDir, name, claudeCommand, prompt, permissionMode, addToast, navigate, addRecentDir]);

  function applyTemplate(template: SessionTemplate): void {
    setName(template.name);
    setWorkDir(template.workDir);
    setPrompt(template.prompt ?? '');
    setClaudeCommand(template.claudeCommand ?? '');
    setPermissionMode(template.permissionMode ?? 'default');
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
<<<<<<< HEAD
          className="p-2 rounded hover:bg-[var(--color-void-lighter)] transition-colors text-gray-400 hover:text-gray-200"
=======
          className="p-2 rounded hover:bg-[var(--color-void-lighter)] transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
>>>>>>> docs/changelog-may-7
          title="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
<<<<<<< HEAD
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">New Session</h1>
          <p className="mt-1 text-sm text-gray-500">Create a new Aegis session</p>
=======
          <h1 className="text-2xl font-bold text-gray-900 dark:text-[var(--color-text-primary)]">New Session</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Create a new Aegis session</p>
>>>>>>> docs/changelog-may-7
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Work Directory */}
        <div>
<<<<<<< HEAD
          <label htmlFor="workDir" className="block text-sm font-medium text-gray-300 mb-1.5">
=======
          <label htmlFor="workDir" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
>>>>>>> docs/changelog-may-7
            Working Directory <span className="text-red-400">*</span>
          </label>
          <input
            id="workDir"
            type="text"
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="/home/user/projects/myapp"
            required
<<<<<<< HEAD
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
          />
          <p className="mt-1 text-xs text-gray-500">Absolute path where the session will run</p>
=======
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-cyan)]"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Absolute path where the session will run</p>
>>>>>>> docs/changelog-may-7

          {/* Recent & Starred Directories */}
          {recent.length > 0 && (
            <div className="mt-3 space-y-2">
              {starred.length > 0 && (
                <div>
<<<<<<< HEAD
                  <p className="text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
=======
                  <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 flex items-center gap-1">
>>>>>>> docs/changelog-may-7
                    <Star className="h-3 w-3" />
                    Starred
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {starred.map((dir) => (
                      <div
                        key={dir.path}
                        className="group relative flex items-center gap-1.5 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-2 py-1 text-xs text-[var(--color-accent-cyan)] transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => setWorkDir(dir.path)}
                          className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                          aria-label={`Use directory ${dir.path}`}
                        >
                          <Star className="h-3 w-3 fill-current" />
                          <span className="font-mono">{dir.path.split('/').pop() || dir.path}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleStar(dir.path); }}
                          className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label="Unstar"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
<<<<<<< HEAD
                <p className="text-xs font-medium text-gray-400 mb-1.5 flex items-center gap-1">
=======
                <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5 flex items-center gap-1">
>>>>>>> docs/changelog-may-7
                  <Clock className="h-3 w-3" />
                  Recent
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {recent.filter((d) => !d.starred).slice(0, 5).map((dir) => (
                    <div
                      key={dir.path}
<<<<<<< HEAD
                      className="group relative flex items-center gap-1.5 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-400 transition-colors"
=======
                      className="group relative flex items-center gap-1.5 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-void-lighter)] transition-colors"
>>>>>>> docs/changelog-may-7
                    >
                      <button
                        type="button"
                        onClick={() => setWorkDir(dir.path)}
                        className="flex items-center gap-1"
                        aria-label={`Use directory ${dir.path}`}
                      >
                        <span className="font-mono">{dir.path.split('/').pop() || dir.path}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleStar(dir.path); }}
                        className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Star"
                      >
                        <Star className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeRecentDir(dir.path); }}
                        className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Session Name */}
        <div>
<<<<<<< HEAD
          <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-1.5">
            Session Name <span className="text-gray-500">(optional)</span>
=======
          <label htmlFor="name" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
            Session Name <span className="text-[var(--color-text-muted)]">(optional)</span>
>>>>>>> docs/changelog-may-7
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-session"
<<<<<<< HEAD
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
=======
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-cyan)]"
>>>>>>> docs/changelog-may-7
          />
        </div>

        {/* Claude Command */}
        <div>
<<<<<<< HEAD
          <label htmlFor="claudeCommand" className="block text-sm font-medium text-gray-300 mb-1.5">
            Claude Command <span className="text-gray-500">(optional)</span>
=======
          <label htmlFor="claudeCommand" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
            Claude Command <span className="text-[var(--color-text-muted)]">(optional)</span>
>>>>>>> docs/changelog-may-7
          </label>
          <input
            id="claudeCommand"
            type="text"
            value={claudeCommand}
            onChange={(e) => setClaudeCommand(e.target.value)}
            placeholder="claude --print"
<<<<<<< HEAD
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
          />
          <p className="mt-1 text-xs text-gray-500">Default: claude --print</p>
=======
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-cyan)]"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Default: claude --print</p>
>>>>>>> docs/changelog-may-7
        </div>

        {/* Initial Prompt */}
        <div>
<<<<<<< HEAD
          <label htmlFor="prompt" className="block text-sm font-medium text-gray-300 mb-1.5">
            Initial Prompt <span className="text-gray-500">(optional)</span>
=======
          <label htmlFor="prompt" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
            Initial Prompt <span className="text-[var(--color-text-muted)]">(optional)</span>
>>>>>>> docs/changelog-may-7
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What do you want to accomplish?"
            rows={3}
<<<<<<< HEAD
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)] resize-y"
=======
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-cyan)] resize-y"
>>>>>>> docs/changelog-may-7
          />
        </div>

        {/* Permission Mode */}
        <div>
<<<<<<< HEAD
          <label htmlFor="permissionMode" className="block text-sm font-medium text-gray-300 mb-1.5">
=======
          <label htmlFor="permissionMode" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
>>>>>>> docs/changelog-may-7
            Permission Mode
          </label>
          <select
            id="permissionMode"
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
<<<<<<< HEAD
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-[var(--color-accent-cyan)]"
=======
            className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-cyan)]"
>>>>>>> docs/changelog-may-7
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Template Selector */}
        {templates.length > 0 && (
          <div>
<<<<<<< HEAD
            <p className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-1.5">
=======
            <p className="text-sm font-medium text-[var(--color-text-primary)] mb-2 flex items-center gap-1.5">
>>>>>>> docs/changelog-may-7
              <FileText className="h-4 w-4" />
              Start from a template
            </p>
            <div className="flex flex-wrap gap-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template)}
<<<<<<< HEAD
                  className="flex items-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
=======
                  className="flex items-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
>>>>>>> docs/changelog-may-7
                  aria-label={`Apply template ${template.name}`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="truncate max-w-[180px]">{template.name}</span>
                </button>
              ))}
            </div>
<<<<<<< HEAD
            <p className="mt-1 text-xs text-gray-500">Click a template to pre-fill the form fields above.</p>
=======
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Click a template to pre-fill the form fields above.</p>
>>>>>>> docs/changelog-may-7
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
<<<<<<< HEAD
            className="px-4 py-2.5 text-sm font-medium rounded border border-[var(--color-void-lighter)] text-gray-300 hover:bg-[var(--color-void-lighter)] transition-colors"
=======
            className="px-4 py-2.5 text-sm font-medium rounded border border-[var(--color-void-lighter)] text-[var(--color-text-primary)] hover:bg-[var(--color-void-lighter)] transition-colors"
>>>>>>> docs/changelog-may-7
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

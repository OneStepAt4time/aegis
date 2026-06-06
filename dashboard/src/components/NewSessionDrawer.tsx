/**
 * components/NewSessionDrawer.tsx — Right-side drawer for creating a new session.
 * Opens via ⌘N, header + button, or programmatic openNewSession().
 * Width: 480px desktop, full-width mobile.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, X } from 'lucide-react';
import { Drawer } from './shared/Drawer';
import { createSessionWithFallback, getTemplates } from '../api/client';
import type { SessionTemplate } from '../types';
import { useToastStore } from '../store/useToastStore';
import { useRecentDirs } from '../hooks/useRecentDirs';
import { useDrawerStore } from '../store/useDrawerStore';
import { useConfetti } from '../hooks/useConfetti';
import { useT } from '../i18n/context';
import { PERMISSION_MODES, validateWorkDir } from '../utils/sessionCreation';



export function NewSessionDrawer() {
  const navigate = useNavigate();
  const addToast = useToastStore((t) => t.addToast);
  const { add: addRecentDir } = useRecentDirs();
  const t = useT();
  const { newSessionOpen, closeNewSession } = useDrawerStore();
  const { triggerFirstSessionConfetti } = useConfetti();

  const [name, setName] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [claudeCommand, setClaudeCommand] = useState('');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState('default');
  const [workDirError, setWorkDirError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap(newSessionOpen, { autoFocus: false });
  const submitButtonRef = useRef<HTMLButtonElement>(null);

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
      setWorkDirError(null);
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
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newSessionOpen, closeNewSession]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const dirError = validateWorkDir(workDir);
    if (dirError) {
      setWorkDirError(dirError);
      return;
    }
    setWorkDirError(null);

    if (!workDir.trim()) {
      addToast('error', t('newSession.missingWorkDir'), t('newSession.missingWorkDirDescription'));
      return;
    }

    setLoading(true);
    try {
      const session = await createSessionWithFallback({
        workDir: workDir.trim(),
        name: name.trim() || undefined,
        claudeCommand: claudeCommand.trim() || undefined,
        prompt: prompt.trim() || undefined,
        permissionMode: permissionMode !== 'default' ? permissionMode : undefined,
      });
      addToast('success', t('newSession.sessionCreated'), session.id);
      
      triggerFirstSessionConfetti(submitButtonRef.current || undefined);
      
      closeNewSession();
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('newSession.failedCreate');
      addToast('error', t('newSession.creationFailed'), msg);
    } finally {
      addRecentDir(workDir.trim());
      setLoading(false);
    }
  }, [workDir, name, claudeCommand, prompt, permissionMode, addToast, navigate, closeNewSession, triggerFirstSessionConfetti, t]);

  return (
    <Drawer
      open={newSessionOpen}
      onClose={closeNewSession}
      ariaLabel={t("aria.newSession")}
      panelRef={trapRef as React.Ref<HTMLDivElement>}
    >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--color-overlay-border)] shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('newSession.title')}</h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('newSession.subtitle')}</p>
              </div>
              <button
                type="button"
                onClick={closeNewSession}
                aria-label={t("aria.closeDrawer")}
                className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text-primary)] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-6 flex-1">
              {/* Work Directory */}
              <div>
                <label htmlFor="drawer-workDir" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('newSession.workDir')} <span className="text-[var(--color-danger)]">*</span>
                </label>
                <input
                  ref={firstInputRef}
                  id="drawer-workDir"
                  type="text"
                  value={workDir}
                  onChange={(e) => { setWorkDir(e.target.value); setWorkDirError(null); }}
                  placeholder={t('newSession.workDirPlaceholder')}
                  required
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus-visible:outline-none focus:border-[var(--color-accent-cyan)]"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('newSession.workDirDescription')}</p>
                {workDirError && (
                  <p className="mt-1 text-xs text-[var(--color-error)]">{workDirError}</p>
                )}
              </div>

              {/* Session Name */}
              <div>
                <label htmlFor="drawer-name" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('newSession.sessionName')} <span className="text-[var(--color-text-muted)]">{t('newSession.optional')}</span>
                </label>
                <input
                  id="drawer-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('newSession.sessionNamePlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus-visible:outline-none focus:border-[var(--color-accent-cyan)]"
                />
              </div>

              {/* Claude Command */}
              <div>
                <label htmlFor="drawer-claudeCommand" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('newSession.claudeCommand')} <span className="text-[var(--color-text-muted)]">{t('newSession.optional')}</span>
                </label>
                <input
                  id="drawer-claudeCommand"
                  type="text"
                  value={claudeCommand}
                  onChange={(e) => setClaudeCommand(e.target.value)}
                  placeholder={t('newSession.commandPlaceholder')}
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus-visible:outline-none focus:border-[var(--color-accent-cyan)]"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('newSession.claudeCommandDefault')}</p>
              </div>

              {/* Initial Prompt */}
              <div>
                <label htmlFor="drawer-prompt" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('newSession.initialPrompt')} <span className="text-[var(--color-text-muted)]">{t('newSession.optional')}</span>
                </label>
                <textarea
                  id="drawer-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t('newSession.promptPlaceholder')}
                  rows={3}
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus-visible:outline-none focus:border-[var(--color-accent-cyan)] resize-y"
                />
              </div>

              {/* Permission Mode */}
              <div>
                <label htmlFor="drawer-permissionMode" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('newSession.permissionMode')}
                </label>
                <select
                  id="drawer-permissionMode"
                  value={permissionMode}
                  onChange={(e) => setPermissionMode(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus-visible:outline-none focus:border-[var(--color-accent-cyan)]"
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {templates.length > 0 && (
                <div>
                  <label htmlFor="drawer-template-select" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                    {t('newSession.startFromTemplate')}
                  </label>
                  <select
                    id="drawer-template-select"
                    value=""
                    onChange={(e) => {
                      const tpl = templates[Number(e.target.value)];
                      if (!tpl) return;
                      if (tpl.name) setName(tpl.name);
                      if (tpl.workDir) setWorkDir(tpl.workDir);
                      if (tpl.prompt) setPrompt(tpl.prompt);
                      if (tpl.permissionMode) setPermissionMode(tpl.permissionMode);
                      if (tpl.claudeCommand) setClaudeCommand(tpl.claudeCommand);
                      useToastStore.getState().addToast('info', `Applied template: ${tpl.name || 'Untitled'}`, undefined, { duration: 2000 });
                    }}
                    className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded text-[var(--color-text-primary)] focus-visible:outline-none focus:border-[var(--color-cta-bg)]"
                  >
                    <option value="" disabled>
                      {templates.length} template{templates.length !== 1 ? 's' : ''} available…
                    </option>
                    {templates.map((t, i) => (
                      <option key={t.id} value={i}>{t.name || 'Untitled'}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2 mt-auto">
                <button
                  ref={submitButtonRef}
                  type="submit"
                  disabled={loading || !workDir.trim()}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded bg-[var(--color-cta)] hover:opacity-90 disabled:opacity-50 text-[var(--color-void)] transition-opacity"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {loading ? t('newSession.creating') : t('newSession.createSession')}
                </button>
                <button
                  type="button"
                  onClick={closeNewSession}
                  className="px-4 py-2.5 text-sm font-medium rounded border border-[var(--color-void-lighter)] text-[var(--color-text-primary)] hover:bg-[var(--color-void-lighter)] transition-colors"
                >
                  {t('newSession.cancel')}
                </button>
              </div>
            </form>
    </Drawer>
  );
}

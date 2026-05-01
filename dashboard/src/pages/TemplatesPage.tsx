/**
 * pages/TemplatesPage.tsx — Session Templates management UI.
 *
 * Lists templates with name, description, and created date.
 * Supports create, edit, delete (with confirmation), and use-template-to-create-session.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  createSession,
  createTemplate,
  deleteTemplate,
  getTemplates,
} from '../api/client';
import type { SessionTemplate } from '../types';
import { useToastStore } from '../store/useToastStore';
import { ConfirmDialog } from '../components/ConfirmDialog';
import TemplateModal from '../components/TemplateModal';

const REFRESH_INTERVAL_MS = 15_000;

export default function TemplatesPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((t) => t.addToast);

  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SessionTemplate | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Use-template loading
  const [usingId, setUsingId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await getTemplates();
      setTemplates(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load templates';
      setError(message);
      if (!silent) {
        addToast('error', 'Failed to load templates', message);
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [addToast]);

  useEffect(() => {
    void fetchTemplates();
    const interval = setInterval(() => {
      void fetchTemplates(true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchTemplates]);

  // ── Handlers ────────────────────────────────────────────────────

  function handleCreate(): void {
    setEditingTemplate(null);
    setModalOpen(true);
  }

  function handleEdit(template: SessionTemplate): void {
    setEditingTemplate(template);
    setModalOpen(true);
  }

  async function handleDelete(id: string): Promise<void> {
    setDeletingId(id);
    try {
      await deleteTemplate(id);
      setTemplates((current) => current.filter((t) => t.id !== id));
      addToast('success', 'Template deleted');
    } catch (err) {
      addToast('error', 'Failed to delete template', err instanceof Error ? err.message : undefined);
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }

  async function handleUseTemplate(template: SessionTemplate): Promise<void> {
    setUsingId(template.id);
    try {
      const session = await createSession({
        workDir: template.workDir,
        name: template.name,
        prompt: template.prompt,
        claudeCommand: template.claudeCommand,
        permissionMode: template.permissionMode,
        env: template.env,
        stallThresholdMs: template.stallThresholdMs,
        autoApprove: template.autoApprove,
        memoryKeys: template.memoryKeys,
      });
      addToast('success', 'Session created from template', `"${template.name}" → ${session.id}`);
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      addToast('error', 'Failed to create session', err instanceof Error ? err.message : undefined);
    } finally {
      setUsingId(null);
    }
  }

  async function handleDuplicate(template: SessionTemplate): Promise<void> {
    try {
      await createTemplate({
        name: `${template.name} (copy)`,
        description: template.description,
        workDir: template.workDir,
        prompt: template.prompt,
        claudeCommand: template.claudeCommand,
        permissionMode: template.permissionMode,
        env: template.env,
        stallThresholdMs: template.stallThresholdMs,
        autoApprove: template.autoApprove,
        memoryKeys: template.memoryKeys,
      });
      addToast('success', 'Template duplicated', `"${template.name}" duplicated`);
      void fetchTemplates(true);
    } catch (err) {
      addToast('error', 'Failed to duplicate template', err instanceof Error ? err.message : undefined);
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6" aria-label="Templates">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Templates</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create reusable session configurations to standardize agent launches.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void fetchTemplates(true)}
            disabled={refreshing}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleCreate}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Template
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center text-sm text-gray-500" role="status" aria-busy="true">
          <div className="animate-pulse">Loading templates…</div>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200" role="alert">
          <p className="font-medium">Unable to load templates</p>
          <p className="mt-1 text-amber-200/80">{error}</p>
          <button
            type="button"
            onClick={() => void fetchTemplates()}
            className="mt-4 rounded border border-amber-500/30 px-3 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/10"
          >
            Retry
          </button>
        </div>
      ) : templates.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-void-lighter)] bg-[var(--color-void)] px-6 text-center" role="status">
          <FileText className="h-8 w-8 text-gray-600" />
          <p className="mt-4 text-sm font-medium text-gray-300">No templates yet</p>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Create a template to define reusable session configurations for common workflows.
          </p>
          <button
            type="button"
            onClick={handleCreate}
            className="mt-4 flex min-h-[40px] items-center gap-2 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-4 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Create your first template
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <article
              key={template.id}
              className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {template.name}
                    </span>
                    {template.permissionMode && template.permissionMode !== 'default' && (
                      <span className="rounded-full border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[11px] text-gray-500">
                        {template.permissionMode}
                      </span>
                    )}
                  </div>
                  {template.description && (
                    <p className="mt-1 text-sm text-gray-400 line-clamp-2">{template.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>
                      Created {new Date(template.createdAt).toLocaleDateString()}
                    </span>
                    <span className="font-mono truncate max-w-[260px]" title={template.workDir}>
                      {template.workDir}
                    </span>
                    {template.prompt && (
                      <span className="truncate max-w-[200px]" title={template.prompt}>
                        Prompt: {template.prompt.slice(0, 50)}{template.prompt.length > 50 ? '…' : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleUseTemplate(template)}
                    disabled={usingId === template.id}
                    className="flex min-h-[40px] items-center justify-center gap-1.5 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {usingId === template.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {usingId === template.id ? 'Starting…' : 'Use'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(template)}
                    className="flex min-h-[40px] items-center justify-center gap-1.5 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDuplicate(template)}
                    className="flex min-h-[40px] items-center justify-center gap-1.5 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
                    title="Duplicate template"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ id: template.id, name: template.name })}
                    disabled={deletingId === template.id}
                    className="flex min-h-[40px] items-center justify-center gap-1.5 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deletingId === template.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <TemplateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        template={editingTemplate}
        onSaved={() => void fetchTemplates(true)}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Template"
        message={deleteTarget ? `Delete template "${deleteTarget.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) {
            void handleDelete(deleteTarget.id);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/**
 * SessionMetadataPanel — display and edit per-session key/value metadata.
 * Part of #4484 — session metadata KV store.
 */

import { useState, useEffect, useCallback } from 'react';
import { useT } from '../../i18n/context';
import { fetchSessionMeta, setSessionMeta, deleteSessionMetaKey } from '../../api/session-metadata';
import type { SessionMetadataMap } from '../../api/session-metadata';

const MAX_KEYS = 20;

interface SessionMetadataPanelProps {
  sessionId: string;
}

export function SessionMetadataPanel({ sessionId }: SessionMetadataPanelProps) {
  const t = useT();
  const [metadata, setMetadata] = useState<SessionMetadataMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchSessionMeta(sessionId);
      setMetadata(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metadata');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key || !value) return;

    const currentCount = Object.keys(metadata).length;
    if (!(key in metadata) && currentCount >= MAX_KEYS) return;

    try {
      setSaving(true);
      const updated = await setSessionMeta(sessionId, { [key]: value });
      setMetadata(updated);
      setNewKey('');
      setNewValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      const updated = await deleteSessionMetaKey(sessionId, key);
      setMetadata(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !saving && newKey.trim() && newValue.trim()) {
      handleAdd();
    }
  };

  const entries = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));
  const keyCount = Object.keys(metadata).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-[var(--color-text-muted)] text-sm animate-pulse">
        {t('metadata.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" role="region" aria-label={t('metadata.panelLabel')}>
      {error && (
        <div className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)] py-4">{t('metadata.empty')}</p>
      ) : (
        <table className="w-full text-left" aria-label={t('metadata.tableLabel')}>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
              <th className="pb-2 font-medium">{t('metadata.key')}</th>
              <th className="pb-2 font-medium">{t('metadata.value')}</th>
              <th className="pb-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors">
                <td className="py-2 pr-3 text-xs font-mono font-medium text-[var(--color-accent-cyan)]">{key}</td>
                <td className="py-2 pr-3 text-xs text-[var(--color-text-primary)] break-all">{value}</td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(key)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors text-xs"
                    aria-label={t('metadata.deleteKey', { key })}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {keyCount < MAX_KEYS && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('metadata.keyPlaceholder')}
            className="min-h-[36px] flex-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] font-mono placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent-cyan)]/50 focus-visible:outline-none"
            aria-label={t('metadata.newKeyLabel')}
          />
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('metadata.valuePlaceholder')}
            className="min-h-[36px] flex-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent-cyan)]/50 focus-visible:outline-none"
            aria-label={t('metadata.newValueLabel')}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !newKey.trim() || !newValue.trim()}
            className="min-h-[36px] rounded bg-[var(--color-accent-cyan)]/10 border border-[var(--color-accent-cyan)]/30 px-3 py-1.5 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('metadata.add')}
          </button>
        </div>
      )}

      <p className="text-[10px] text-[var(--color-text-muted)]">
        {t('metadata.countHint', { count: keyCount, max: MAX_KEYS })}
      </p>
    </div>
  );
}

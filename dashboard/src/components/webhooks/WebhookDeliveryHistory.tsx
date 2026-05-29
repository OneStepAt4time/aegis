/**
 * WebhookDeliveryHistory — shows delivery log per hook with pass/fail indicators.
 * Part of #4486 — webhook delivery tracking.
 */

import { useState, useEffect } from 'react';
import { useT } from '../../i18n/context';
import { fetchWebhookDeliveries, fetchWebhooks } from '../../api/webhook-deliveries';
import type { WebhookDelivery, WebhookInfo, DeliveryStatus } from '../../types/webhook-delivery';

// ── Helpers ────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusDot(status: DeliveryStatus): { color: string; label: string } {
  switch (status) {
    case 'success': return { color: 'bg-[var(--color-success)]', label: 'Pass' };
    case 'failed': return { color: 'bg-[var(--color-danger)]', label: 'Fail' };
    case 'retrying': return { color: 'bg-[var(--color-warning)]', label: 'Retry' };
  }
}

// ── Sub-components ─────────────────────────────────────────

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const { color, label } = statusDot(status);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs font-medium">{label}</span>
    </span>
  );
}

function DeliveryRow({ delivery }: { delivery: WebhookDelivery }) {
  const t = useT();
  return (
    <tr className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors">
      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
        {formatTimestamp(delivery.timestamp)}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={delivery.status} />
      </td>
      <td className="px-3 py-2 text-xs font-mono text-[var(--color-text-muted)]">
        {delivery.statusCode || '—'}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
        {formatDuration(delivery.durationMs)}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
        {delivery.attemptCount > 1 ? `${delivery.attemptCount} ${t('webhooks.attempts')}` : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--color-danger)] truncate max-w-[200px]" title={delivery.errorMessage}>
        {delivery.errorMessage || '—'}
      </td>
    </tr>
  );
}

function HookDeliveryPanel({ hook }: { hook: WebhookInfo }) {
  const t = useT();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWebhookDeliveries(hook.id)
      .then((res) => { if (!cancelled) setDeliveries(res.deliveries); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hook.id, expanded]);

  const successCount = deliveries.filter((d) => d.status === 'success').length;
  const failCount = deliveries.filter((d) => d.status === 'failed').length;
  const total = deliveries.length;

  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${hook.enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}`} />
          <div>
            <h4 className="text-sm font-medium text-[var(--color-text-primary)]">{hook.name}</h4>
            <p className="text-xs text-[var(--color-text-muted)] font-mono truncate max-w-[300px]">{hook.url}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          {total > 0 && (
            <>
              <span className="text-[var(--color-success)]">{successCount} ✓</span>
              {failCount > 0 && <span className="text-[var(--color-danger)]">{failCount} ✗</span>}
            </>
          )}
          <span className="text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)]">
          {loading ? (
            <div className="px-5 py-6 text-sm text-[var(--color-text-muted)] animate-pulse">
              {t('webhooks.loadingDeliveries')}
            </div>
          ) : error ? (
            <div className="px-5 py-4 text-sm text-[var(--color-danger)]">{error}</div>
          ) : deliveries.length === 0 ? (
            <div className="px-5 py-6 text-sm text-[var(--color-text-muted)]">{t('webhooks.noDeliveries')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left" aria-label={t('webhooks.deliveryTable')}>
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="px-3 py-2 font-medium">{t('webhooks.timestamp')}</th>
                    <th className="px-3 py-2 font-medium">{t('webhooks.status')}</th>
                    <th className="px-3 py-2 font-medium">{t('webhooks.statusCode')}</th>
                    <th className="px-3 py-2 font-medium">{t('webhooks.duration')}</th>
                    <th className="px-3 py-2 font-medium">{t('webhooks.attempts')}</th>
                    <th className="px-3 py-2 font-medium">{t('webhooks.error')}</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => <DeliveryRow key={d.id} delivery={d} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export function WebhookDeliveryHistory() {
  const t = useT();
  const [hooks, setHooks] = useState<WebhookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWebhooks()
      .then((res) => { if (!cancelled) setHooks(res); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section aria-labelledby="webhook-delivery-heading">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 id="webhook-delivery-heading" className="text-lg font-medium text-[var(--color-text-primary)]">
            {t('webhooks.deliveryHistory')}
          </h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t('webhooks.deliveryHistoryDescription')}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : hooks.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
          {t('webhooks.noHooks')}
        </div>
      ) : (
        <div className="space-y-3">
          {hooks.map((hook) => <HookDeliveryPanel key={hook.id} hook={hook} />)}
        </div>
      )}
    </section>
  );
}

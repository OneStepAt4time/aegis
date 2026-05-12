/**
 * components/session/InterventionHistoryPanel.tsx — History of pause/resume/intervention events.
 *
 * Displays a timeline of all intervention actions taken on a session.
 * TODO: Wire to real API once ACP-023 (event replay) and ACP-064 (control actions) land.
 */

import { useState, useEffect, useCallback } from 'react';
import { Pause, Play, Hand, CheckCircle, Loader2 } from 'lucide-react';
import type { AcpPauseInterventionRecord } from '../../types/acp-pause';
import { getSessionIntervention } from '../../api/acp-pause-client';
import { useT } from '../../i18n/context';

export interface InterventionHistoryPanelProps {
  sessionId: string;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Timeline entry representing one action in the intervention lifecycle. */
interface TimelineEntry {
  icon: typeof Pause;
  label: string;
  detail: string;
  timestamp: string;
  tone: 'amber' | 'blue' | 'green';
}

function buildTimeline(record: AcpPauseInterventionRecord): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  entries.push({
    icon: Pause,
    label: 'Session Paused',
    detail: record.reason,
    timestamp: formatTimestamp(record.requestedAt),
    tone: 'amber',
  });

  if (record.interventionStartedAt) {
    entries.push({
      icon: Hand,
      label: 'Intervention Started',
      detail: record.interventionBy ? `by ${record.interventionBy}` : '',
      timestamp: formatTimestamp(record.interventionStartedAt),
      tone: 'blue',
    });
  }

  if (record.interventionCompletedAt) {
    entries.push({
      icon: CheckCircle,
      label: 'Intervention Completed',
      detail: record.guidance ? `Guidance: ${record.guidance}` : '',
      timestamp: formatTimestamp(record.interventionCompletedAt),
      tone: 'blue',
    });
  }

  if (record.resumedAt) {
    entries.push({
      icon: Play,
      label: 'Session Resumed',
      detail: record.resumedBy ? `by ${record.resumedBy}` : '',
      timestamp: formatTimestamp(record.resumedAt),
      tone: 'green',
    });
  }

  return entries;
}

const TONE_STYLES = {
  amber: 'border-amber-500/30 bg-amber-500/5',
  blue: 'border-blue-500/30 bg-blue-500/5',
  green: 'border-green-500/30 bg-green-500/5',
} as const;

const TONE_ICON_STYLES = {
  amber: 'text-amber-400',
  blue: 'text-blue-400',
  green: 'text-green-400',
} as const;

export function InterventionHistoryPanel({ sessionId }: InterventionHistoryPanelProps) {
    const t = useT();

  const [record, setRecord] = useState<AcpPauseInterventionRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRecord = useCallback(async () => {
    try {
      const result = await getSessionIntervention(sessionId);
      setRecord(result);
    } catch {
      setRecord(null);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchRecord();
  }, [fetchRecord]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8" role="status" aria-label={t("aria.loadingIntervention")}>
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-muted)]" />
        <span className="ml-2 text-sm text-[var(--color-text-muted)]">Loading intervention history...</span>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-void-lighter)]" role="status">
        No intervention history for this session.
      </div>
    );
  }

  const timeline = buildTimeline(record);

  return (
    <div className="flex flex-col gap-1" role="list" aria-label={t("aria.interventionTimeline")}>
      {timeline.map((entry, i) => {
        const Icon = entry.icon;
        return (
          <div
            key={i}
            className={`flex items-start gap-3 rounded-md border p-3 ${TONE_STYLES[entry.tone]}`}
            role="listitem"
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_ICON_STYLES[entry.tone]}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{entry.label}</span>
                {entry.timestamp && (
                  <span className="shrink-0 text-xs text-[var(--color-void-lighter)]">{entry.timestamp}</span>
                )}
              </div>
              {entry.detail && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)] break-words">{entry.detail}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import type { SessionSummary } from '../../types';
import { formatTimeAgo } from '../../utils/format';

interface SessionSummaryCardProps {
  summary: SessionSummary | null;
  loading: boolean;
}

interface SummaryMetricProps {
  label: string;
  value: number | string;
  accentClassName: string;
}

function SummaryMetric({ label, value, accentClassName }: SummaryMetricProps) {
  return (
    <div className="rounded-md border border-[#1a1a2e] bg-[#111118] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#666]">{label}</div>
      <div className={`mt-1 font-mono text-lg ${accentClassName}`}>{value}</div>
    </div>
  );
}

function countMessagesByRole(messages: SessionSummary['messages']): Record<string, number> {
  return messages.reduce<Record<string, number>>((counts, message) => {
    const role = message.role.trim().toLowerCase();
    counts[role] = (counts[role] ?? 0) + 1;
    return counts;
  }, {});
}

export function SessionSummaryCard({ summary, loading }: SessionSummaryCardProps) {
  if (loading) {
    return (
      <section className="rounded-lg border border-[#1a1a2e] bg-[#0d0d14] px-4 py-3 animate-pulse">
        <div className="h-3 w-28 rounded bg-[#1a1a2e]" />
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-16 rounded-md bg-[#111118]" />
          ))}
        </div>
      </section>
    );
  }

  if (!summary) {
    return null;
  }

  const messageCounts = countMessagesByRole(summary.messages);
  const userMessages = messageCounts.user ?? 0;
  const assistantMessages = messageCounts.assistant ?? 0;
  const systemMessages = messageCounts.system ?? 0;
  const otherMessages = summary.totalMessages - userMessages - assistantMessages - systemMessages;
  const lastActivityText = formatTimeAgo(summary.lastActivity);
  const createdText = formatTimeAgo(summary.createdAt);

  return (
    <section className="rounded-lg border border-[#1a1a2e] bg-[#0d0d14] px-4 py-3 sm:px-5 sm:py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#666]">Session Summary</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#888]">
            <span className="rounded-full border border-[#00e5ff]/25 bg-[#00e5ff]/10 px-2 py-1 font-semibold uppercase tracking-[0.14em] text-[#00e5ff]">
              {summary.status.replace(/_/g, ' ')}
            </span>
            <span>Started {createdText}</span>
            <span className="text-[#333]">•</span>
            <span>Last active {lastActivityText}</span>
          </div>
        </div>
        <div className="text-xs text-[#666]">
          Permission mode <span className="font-semibold text-[#b8b8c8]">{summary.permissionMode || 'default'}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryMetric label="Total Messages" value={summary.totalMessages} accentClassName="text-[#00e5ff]" />
        <SummaryMetric label="User" value={userMessages} accentClassName="text-[#7dd3fc]" />
        <SummaryMetric label="Assistant" value={assistantMessages} accentClassName="text-[#34d399]" />
        <SummaryMetric label="System" value={systemMessages} accentClassName="text-[#f59e0b]" />
        <SummaryMetric label="Other" value={Math.max(otherMessages, 0)} accentClassName="text-[#c084fc]" />
      </div>
    </section>
  );
}
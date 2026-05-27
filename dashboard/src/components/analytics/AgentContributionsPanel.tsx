/**
 * AgentContributionsPanel.tsx — Per-agent git contribution stats.
 *
 * Shows commit count, lines changed, PRs opened, and contribution bars
 * for each agent. Part of issue #3269: agent git identity tracking. // token-ok
 *
 * Mock data until backend provides per-agent git identity (#3269 backend). // token-ok
 * @ticket #3399 — chart polish with design tokens // token-ok
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip as ChartJSTooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, ChartJSTooltip);
import { formatCompact } from '../../utils/formatNumber';
import { GitBranch, GitCommit, GitPullRequest, Users } from 'lucide-react';
import {
  AGENT_COLORS,
  CHART_RGB,
} from '../../utils/chartTheme';

export interface AgentContribution {
  agent: string;
  commits: number;
  additions: number;
  deletions: number;
  prs: number;
  role: string;
}

export interface AgentContributionsPanelProps {
  data?: AgentContribution[];
  loading?: boolean;
  className?: string;
}

const MOCK_DATA: AgentContribution[] = [
  { agent: 'Hephaestus', commits: 87, additions: 12840, deletions: 3210, prs: 12, role: 'Backend' },
  { agent: 'Daedalus', commits: 64, additions: 9650, deletions: 1820, prs: 9, role: 'Frontend' },
  { agent: 'Argus', commits: 31, additions: 2100, deletions: 890, prs: 5, role: 'Review' },
  { agent: 'Scribe', commits: 22, additions: 4320, deletions: 420, prs: 4, role: 'Docs' },
  { agent: 'Hermes', commits: 15, additions: 1800, deletions: 600, prs: 3, role: 'DevOps' },
  { agent: 'Athena', commits: 8, additions: 920, deletions: 180, prs: 2, role: 'PM' },
];


export function AgentContributionsPanel({ data, loading = false, className = '' }: AgentContributionsPanelProps) {
  const contributions = data ?? MOCK_DATA;

  const totalCommits = contributions.reduce((s, a) => s + a.commits, 0);
  const totalAdditions = contributions.reduce((s, a) => s + a.additions, 0);
  const totalDeletions = contributions.reduce((s, a) => s + a.deletions, 0);
  const totalPRs = contributions.reduce((s, a) => s + a.prs, 0);

  if (loading) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Agent contributions loading"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Agent Contributions
        </h3>
        <div className="flex h-64 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent-cyan)] border-t-transparent" />
        </div>
      </section>
    );
  }

  if (contributions.length === 0) {
    return (
      <section
        className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
        aria-label="Agent contributions"
      >
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Agent Contributions
        </h3>
        <p className="py-12 text-center text-sm text-[var(--color-text-muted)]">
          No agent contribution data available yet.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 ${className}`}
      aria-label="Agent contributions panel"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
          <Users className="mr-2 inline h-5 w-5 text-[var(--color-accent-cyan)]" />
          Agent Contributions
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          Per-agent git attribution
        </span>
      </div>

      {/* Summary KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <GitCommit className="h-3 w-3" />
            Commits
          </div>
          <div className="mt-1 text-lg font-bold font-mono text-[var(--color-text-primary)]">
            {formatCompact(totalCommits)}
          </div>
        </div>
        <div className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <GitBranch className="h-3 w-3" />
            Lines Changed
          </div>
          <div className="mt-1 text-lg font-bold font-mono text-[var(--color-text-primary)]">
            <span className="text-[var(--color-success)]">+{formatCompact(totalAdditions)}</span>
            <span className="mx-1 text-[var(--color-text-muted)]">/</span>
            <span className="text-[var(--color-danger)]">-{formatCompact(totalDeletions)}</span>
          </div>
        </div>
        <div className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <GitPullRequest className="h-3 w-3" />
            PRs
          </div>
          <div className="mt-1 text-lg font-bold font-mono text-[var(--color-text-primary)]">
            {totalPRs}
          </div>
        </div>
        <div className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3">
          <div className="text-xs text-[var(--color-text-muted)]">
            <Users className="inline h-3 w-3 mr-1" />
            Active Agents
          </div>
          <div className="mt-1 text-lg font-bold font-mono text-[var(--color-text-primary)]">
            {contributions.length}
          </div>
        </div>
      </div>

      {/* Commit chart — horizontal bar */}
      <div style={{ height: 224 }}>
        <Bar
          data={{
            labels: contributions.map((d) => d.agent),
            datasets: [{
              data: contributions.map((d) => d.commits),
              backgroundColor: contributions.map((d) => {
                const cssVar = AGENT_COLORS[d.agent] ?? AGENT_COLORS.other;
                const rgbMap: Record<string, string> = {
                  'var(--color-accent-cyan)': CHART_RGB.cyan,
                  'var(--color-accent-purple)': CHART_RGB.purple,
                  'var(--color-success)': CHART_RGB.success,
                  'var(--color-warning)': CHART_RGB.warning,
                  'var(--color-info)': CHART_RGB.info,
                  'var(--color-text-muted)': CHART_RGB.cyan,
                };
                return `rgba(${rgbMap[cssVar] ?? CHART_RGB.cyan}, 0.7)`;
              }),
              borderWidth: 0,
              borderRadius: 4,
              barPercentage: 0.7,
            }],
          }}
          options={{
            indexAxis: 'y' as const,
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 500 },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: 'rgba(15, 15, 20, 0.95)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 1,
                bodyColor: 'rgba(255, 255, 255, 0.9)',
                padding: 12,
                cornerRadius: 8,
                callbacks: {
                  label: (item: { raw: unknown }) => String(Number(item.raw)) + ' commits',
                },
              },
            },
            scales: {
              x: {
                grid: { drawOnChartArea: true, color: 'rgba(255, 255, 255, 0.06)' },
                ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 11 } },
                border: { color: 'rgba(255, 255, 255, 0.06)' },
              },
              y: {
                grid: { display: false },
                ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 11 } },
                border: { color: 'rgba(255, 255, 255, 0.06)' },
              },
            },
          }}
        />
      </div>

      {/* Agent list */}
      <div className="mt-4 space-y-2">
        {contributions.map((agent) => {
          const commitPct = totalCommits > 0 ? (agent.commits / totalCommits) * 100 : 0;
          return (
            <div key={agent.agent} className="flex items-center gap-3">
              <div
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: AGENT_COLORS[agent.agent] ?? AGENT_COLORS.other }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    {agent.agent}
                    <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">({agent.role})</span>
                  </span>
                  <span className="text-xs font-mono text-[var(--color-text-muted)]">
                    {agent.commits} commits · {agent.prs} PRs
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-[var(--color-void-light)]">
                  <div
                    className="h-1.5 rounded-full transition-all duration-[var(--duration-cinematic)]"
                    style={{
                      width: `${commitPct}%`,
                      backgroundColor: AGENT_COLORS[agent.agent] ?? AGENT_COLORS.other,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

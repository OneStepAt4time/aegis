/**
 * AgentContributionsPanel.tsx — Per-agent git contribution stats.
 *
 * Shows commit count, lines changed, PRs opened, and contribution bars
 * for each agent. Part of issue #3269: agent git identity tracking.
 *
 * Mock data until backend provides per-agent git identity (#3269 backend).
 * @ticket #3399 — chart polish with design tokens
 */

import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { ChartFrame } from '../shared/ChartFrame';
import { formatCompact } from '../../utils/formatNumber';
import { GitBranch, GitCommit, GitPullRequest, Users } from 'lucide-react';
import {
  AGENT_COLORS,
  CHART_GRID, CHART_TICK, CHART_AXIS,
  CHART_ANIMATION, TOOLTIP_STYLE,
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

function CustomTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: AgentContribution }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={TOOLTIP_STYLE.container}>
      <p className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">
        {point.agent}
        <span className="ml-2 text-xs text-[var(--color-text-muted)]">{point.role}</span>
      </p>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between gap-6">
          <span className={TOOLTIP_STYLE.rowLabel}>Commits</span>
          <span className="font-mono font-medium text-[var(--color-text-primary)]">{point.commits}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-[var(--color-success)]">+{formatCompact(point.additions)}</span>
          <span className="text-[var(--color-danger)]">-{formatCompact(point.deletions)}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className={TOOLTIP_STYLE.rowLabel}>PRs</span>
          <span className="font-mono font-medium text-[var(--color-text-primary)]">{point.prs}</span>
        </div>
      </div>
    </div>
  );
}

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
      <ChartFrame className="h-56 min-w-0" label="Agent commits chart loading">
        {({ width, height }) => (
          <BarChart width={width} height={height} data={contributions} layout="vertical" margin={{ left: 10 }}>
            <CartesianGrid {...CHART_GRID} horizontal={false} />
            <XAxis
              type="number"
              tick={CHART_TICK}
              {...CHART_AXIS}
            />
            <YAxis
              type="category"
              dataKey="agent"
              tick={CHART_TICK}
              {...CHART_AXIS}
              width={90}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="commits" radius={[0, 4, 4, 0]} animationDuration={CHART_ANIMATION.duration}>
              {contributions.map((entry) => (
                <Cell
                  key={entry.agent}
                  fill={AGENT_COLORS[entry.agent] ?? AGENT_COLORS.other}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartFrame>

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
                    className="h-1.5 rounded-full transition-all duration-500"
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

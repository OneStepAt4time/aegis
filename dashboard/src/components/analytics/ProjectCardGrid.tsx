/**
 * components/analytics/ProjectCardGrid.tsx — Per-project summary cards with sparklines.
 *
 * Renders a responsive grid of project cards, each showing:
 * - Project name (derived from workDir)
 * - Total cost, token usage, session count
 * - Inline SVG sparkline for cost trend
 *
 * Click-through navigates to the per-project detail route.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, DollarSign, Cpu, Activity } from 'lucide-react';
import { formatCurrency, formatCompact } from '../../utils/formatNumber';
import { SparkLine } from '../overview/SparkLine';

export interface ProjectSummary {
  name: string;
  workDir: string;
  sessions: number;
  totalCostUsd: number;
  totalTokens: number;
  costTrend: number[];
}

interface ProjectCardGridProps {
  projects: ProjectSummary[];
  className?: string;
}

export function ProjectCardGrid({ projects, className = '' }: ProjectCardGridProps) {
  if (projects.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-[var(--color-text-muted)]">
        No project data available
      </div>
    );
  }

  return (
    <div
      className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 ${className}`}
      role="list"
      aria-label="Project cards"
    >
      {projects.map((project) => (
        <ProjectCard key={project.workDir} project={project} />
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    navigate(`/analytics/${encodeURIComponent(project.name)}`);
  }, [navigate, project.name]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4 text-left transition-all hover:border-[var(--color-accent-cyan)]/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      role="listitem"
      aria-label={`${project.name}: ${project.sessions} sessions, ${formatCurrency(project.totalCostUsd)} cost`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <FolderKanban className="h-4 w-4 shrink-0 text-[var(--color-accent-cyan)]" />
        <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
          {project.name}
        </span>
      </div>

      {/* Metrics row */}
      <div className="mb-3 grid grid-cols-3 gap-3">
        <MetricPill
          icon={<DollarSign className="h-3 w-3" />}
          value={formatCurrency(project.totalCostUsd)}
          label="cost"
        />
        <MetricPill
          icon={<Cpu className="h-3 w-3" />}
          value={formatCompact(project.totalTokens)}
          label="tokens"
        />
        <MetricPill
          icon={<Activity className="h-3 w-3" />}
          value={String(project.sessions)}
          label="sessions"
        />
      </div>

      {/* Sparkline */}
      {project.costTrend.length >= 2 && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-muted)]">Cost trend</span>
          <SparkLine
            data={project.costTrend}
            width={100}
            height={20}
            color="var(--color-accent-cyan)"
            ariaLabel={`Cost trend for ${project.name}`}
          />
        </div>
      )}
    </button>
  );
}

function MetricPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md bg-[var(--color-surface)] px-2 py-1.5">
      <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <span className="font-mono text-xs font-medium text-[var(--color-text-primary)]">
        {value}
      </span>
    </div>
  );
}

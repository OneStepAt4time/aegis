/**
 * components/session/PRStatusPanel.tsx — CI/PR integration for session detail (#2907).
 *
 * Phase 1: Parse PR info from transcript tool_use entries.
 * Detects `gh pr create` and `git push` commands and extracts PR URLs/branch info.
 * Shows PR link, branch name, and clean empty states when no PR detected.
 */

import { useMemo } from 'react';
import { GitPullRequest, ExternalLink, GitBranch, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import type { ParsedEntry } from '../../types';

/** Parsed PR info extracted from transcript. */
export interface ParsedPRInfo {
  /** PR URL (e.g., https://github.com/org/repo/pull/123) */
  prUrl: string | null;
  /** PR number extracted from URL */
  prNumber: number | null;
  /** Branch name from git push commands */
  branch: string | null;
  /** Repo from PR URL */
  repo: string | null;
}

/** Parse PR info from transcript entries. */
export function parsePRFromTranscript(entries: ParsedEntry[]): ParsedPRInfo {
  let prUrl: string | null = null;
  let prNumber: number | null = null;
  let branch: string | null = null;
  let repo: string | null = null;

  for (const entry of entries) {
    if (entry.contentType !== 'tool_use' || entry.toolName !== 'bash') continue;

    const text = entry.text;

    // Match "gh pr create" output — typically contains the PR URL
    if (text.includes('gh pr create') || text.includes('gh pr merge')) {
      // Look for GitHub PR URL in the text or surrounding tool_result
      const urlMatch = text.match(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/);
      if (urlMatch) {
        prUrl = urlMatch[0];
        prNumber = parseInt(urlMatch[2], 10);
        repo = urlMatch[1];
      }
    }

    // Match git push to detect branch
    const pushMatch = text.match(/git\s+push.*origin\s+([^\s]+)/);
    if (pushMatch) {
      branch = pushMatch[1];
    }

    // Match "git push --set-upstream origin BRANCH"
    const upstreamMatch = text.match(/--set-upstream\s+origin\s+([^\s]+)/);
    if (upstreamMatch) {
      branch = upstreamMatch[1];
    }
  }

  return { prUrl, prNumber, branch, repo };
}

export interface PRStatusPanelProps {
  /** Transcript entries to parse for PR info. */
  entries: ParsedEntry[];
  /** Whether transcript is still loading. */
  isLoading?: boolean;
}

/** Status indicator for CI checks. */
function CIStatusBadge({ status }: { status: 'pass' | 'fail' | 'pending' | 'unknown' }) {
  const config = {
    pass: { icon: CheckCircle2, color: 'text-[var(--color-success)]', label: 'CI passing' },
    fail: { icon: XCircle, color: 'text-[var(--color-error)]', label: 'CI failing' },
    pending: { icon: Clock, color: 'text-[var(--color-warning)]', label: 'CI pending' },
    unknown: { icon: Clock, color: 'text-[var(--color-text-muted)]', label: 'CI unknown' },
  };
  const { icon: Icon, color, label } = config[status];
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`} title={label} aria-label={label}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

export function PRStatusPanel({ entries, isLoading }: PRStatusPanelProps) {
  const prInfo = useMemo(() => parsePRFromTranscript(entries), [entries]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6" role="status" aria-busy="true">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-cyan)]" />
        <span className="ml-2 text-sm text-[var(--color-text-muted)]">Scanning transcript for PR info…</span>
      </div>
    );
  }

  // No PR detected — clean empty state
  if (!prInfo.prUrl && !prInfo.branch) {
    return (
      <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-6">
        <div className="flex items-center gap-3 mb-3">
          <GitPullRequest className="h-5 w-5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Pull Request</h3>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          No pull request detected for this session. PR info will appear here when a PR is created via <code className="rounded bg-[var(--color-void-lighter)] px-1 py-0.5 font-mono text-[10px]">gh pr create</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-6">
      <div className="flex items-center gap-3 mb-4">
        <GitPullRequest className="h-5 w-5 text-[var(--color-accent-cyan)]" aria-hidden="true" />
        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Pull Request</h3>
        <CIStatusBadge status="unknown" />
      </div>

      <div className="space-y-3">
        {/* PR Link */}
        {prInfo.prUrl && (
          <div className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            <a
              href={prInfo.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[var(--color-accent-cyan)] hover:underline"
            >
              {prInfo.repo ? `${prInfo.repo}#${prInfo.prNumber}` : `PR #${prInfo.prNumber}`}
            </a>
          </div>
        )}

        {/* Branch */}
        {prInfo.branch && (
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            <span className="font-mono text-xs text-[var(--color-text-primary)]">{prInfo.branch}</span>
          </div>
        )}

        {/* Repo */}
        {prInfo.repo && (
          <div className="text-xs text-[var(--color-text-muted)]">
            Repository: <span className="font-mono">{prInfo.repo}</span>
          </div>
        )}
      </div>

      {/* Phase 2 hint */}
      <div className="mt-4 border-t border-[var(--color-border-strong)] pt-3">
        <p className="text-[10px] text-[var(--color-text-muted)] opacity-60">
          CI status and review comments require GitHub API integration (Phase 2).
        </p>
      </div>
    </div>
  );
}

export type ConsensusFocusArea = 'correctness' | 'security' | 'performance';

export interface ConsensusRequest {
  id: string;
  targetSessionId: string;
  reviewerIds: string[];
  focusAreas: ConsensusFocusArea[];
  status: 'running' | 'completed' | 'failed';
  findings: string[];
  createdAt: number;
}

export interface ConsensusReview {
  reviewerId: string;
  focusArea: ConsensusFocusArea;
  findings: string[];
}

export function buildConsensusPrompt(targetSessionId: string, focusArea: ConsensusFocusArea): string {
  return [
    `Review Aegis session ${targetSessionId}.`,
    `Focus area: ${focusArea}.`,
    'Return concise findings ordered by severity.',
    'Prefer concrete regressions, risks, and missing verification.',
  ].join(' ');
}

export function mergeConsensusFindings(reviews: ConsensusReview[]): string[] {
  const merged = new Set<string>();
  for (const review of reviews) {
    for (const finding of review.findings) {
      const normalized = finding.trim();
      if (normalized) merged.add(normalized);
    }
  }
  return Array.from(merged.values());
}

/**
 * #1422: Extract findings from a reviewer session's parsed transcript entries.
 *
 * Collects all assistant text messages and splits them into individual findings.
 * Each non-empty line is treated as a separate finding, matching the structured
 * output that Claude Code produces when given the consensus review prompt.
 */
export function parseReviewOutput(entries: { role: string; contentType: string; text: string }[]): string[] {
  const findings: string[] = [];
  for (const entry of entries) {
    if (entry.role !== 'assistant' || entry.contentType !== 'text') continue;
    for (const line of entry.text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) findings.push(trimmed);
    }
  }
  return findings;
}

export type ConsensusFocusArea = 'correctness' | 'security' | 'performance';

export interface ConsensusRequest {
  id: string;
  targetSessionId: string;
  reviewerIds: string[];
  focusAreas: ConsensusFocusArea[];
  status: 'running' | 'completed' | 'failed';
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

import { describe, it, expect } from 'vitest';
import { buildConsensusPrompt, mergeConsensusFindings } from '../consensus.js';

describe('Issue #734: consensus helpers', () => {
  it('builds focus-specific reviewer prompt', () => {
    const prompt = buildConsensusPrompt('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'security');
    expect(prompt).toContain('security');
    expect(prompt).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('deduplicates findings across reviewers', () => {
    const findings = mergeConsensusFindings([
      { reviewerId: 'r1', focusArea: 'correctness', findings: ['Bug A', 'Bug B'] },
      { reviewerId: 'r2', focusArea: 'security', findings: ['Bug B', 'Risk C'] },
    ]);
    expect(findings).toEqual(['Bug A', 'Bug B', 'Risk C']);
  });

  it('ignores empty findings', () => {
    const findings = mergeConsensusFindings([
      { reviewerId: 'r1', focusArea: 'performance', findings: ['  ', 'Slow path'] },
    ]);
    expect(findings).toEqual(['Slow path']);
  });
});

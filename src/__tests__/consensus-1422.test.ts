import { describe, it, expect } from 'vitest';
import {
  parseReviewOutput,
  mergeConsensusFindings,
  resolveConsensusRequestStatus,
  type ConsensusReview,
} from '../consensus.js';

describe('Issue #1422: consensus status completion', () => {
  describe('resolveConsensusRequestStatus', () => {
    it('returns completed when all reviewers are idle and none failed', () => {
      expect(resolveConsensusRequestStatus(true, false)).toBe('completed');
    });

    it('returns failed when at least one reviewer failed', () => {
      expect(resolveConsensusRequestStatus(false, true)).toBe('failed');
    });

    it('returns failed when all reviewers failed', () => {
      expect(resolveConsensusRequestStatus(true, true)).toBe('failed');
    });

    it('returns running when reviewers are still in progress and no failures occurred', () => {
      expect(resolveConsensusRequestStatus(false, false)).toBe('running');
    });
  });

  describe('parseReviewOutput', () => {
    it('extracts findings from assistant text entries', () => {
      const entries = [
        { role: 'assistant', contentType: 'text', text: 'Finding 1\nFinding 2\nFinding 3' },
      ];
      expect(parseReviewOutput(entries)).toEqual(['Finding 1', 'Finding 2', 'Finding 3']);
    });

    it('ignores non-assistant and non-text entries', () => {
      const entries = [
        { role: 'user', contentType: 'text', text: 'Review this session' },
        { role: 'assistant', contentType: 'tool_use', text: 'Grep pattern' },
        { role: 'assistant', contentType: 'thinking', text: 'Let me analyze...' },
        { role: 'assistant', contentType: 'text', text: 'Actual finding' },
      ];
      expect(parseReviewOutput(entries)).toEqual(['Actual finding']);
    });

    it('skips blank lines within assistant text', () => {
      const entries = [
        { role: 'assistant', contentType: 'text', text: 'Finding A\n\n  \nFinding B' },
      ];
      expect(parseReviewOutput(entries)).toEqual(['Finding A', 'Finding B']);
    });

    it('returns empty array for entries with no assistant text', () => {
      const entries = [
        { role: 'user', contentType: 'text', text: 'Hello' },
        { role: 'assistant', contentType: 'tool_result', text: 'result' },
      ];
      expect(parseReviewOutput(entries)).toEqual([]);
    });

    it('collects findings from multiple assistant messages', () => {
      const entries = [
        { role: 'assistant', contentType: 'text', text: 'First finding' },
        { role: 'assistant', contentType: 'text', text: 'Second finding' },
      ];
      expect(parseReviewOutput(entries)).toEqual(['First finding', 'Second finding']);
    });
  });

  describe('end-to-end: mergeConsensusFindings after parsing', () => {
    it('deduplicates findings extracted from multiple reviewers', () => {
      const reviews: ConsensusReview[] = [
        {
          reviewerId: 'r1',
          focusArea: 'security',
          findings: parseReviewOutput([
            { role: 'assistant', contentType: 'text', text: 'SQL injection risk in query builder' },
            { role: 'assistant', contentType: 'text', text: 'Missing input validation' },
          ]),
        },
        {
          reviewerId: 'r2',
          focusArea: 'correctness',
          findings: parseReviewOutput([
            { role: 'assistant', contentType: 'text', text: 'SQL injection risk in query builder' },
            { role: 'assistant', contentType: 'text', text: 'Off-by-one in pagination' },
          ]),
        },
      ];
      const merged = mergeConsensusFindings(reviews);
      expect(merged).toEqual([
        'SQL injection risk in query builder',
        'Missing input validation',
        'Off-by-one in pagination',
      ]);
    });
  });
});

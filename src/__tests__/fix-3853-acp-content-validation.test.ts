/**
 * Issue #3853: ACP content validation — hallucination detection tests
 *
 * Tests the shared content-validation module (#3896 refactor).
 * Previously duplicated the implementation — now imports from production code.
 */
import { describe, it, expect } from 'vitest';

import {
  validatePromptOutput,
  extractResultText,
  HALLUCINATION_SIGNATURES,
} from '../services/acp/content-validation.js';

describe('ACP content validation (#3853)', () => {
  describe('hallucination signature detection', () => {
    it('detects [TRACE] signature', () => {
      const warnings = validatePromptOutput('[TRACE] hallucinated output here', 'refactor typescript authentication module');
      const sig = warnings.find(w => w.code === 'hallucination_signature');
      expect(sig).toBeDefined();
    });

    it('detects [THINKING] signature', () => {
      const warnings = validatePromptOutput('[THINKING] about this problem', 'fix the critical bug in authentication middleware');
      const sig = warnings.find(w => w.code === 'hallucination_signature');
      expect(sig).toBeDefined();
    });

    it('detects <thinking> tag', () => {
      const warnings = validatePromptOutput('<thinking>Let me think</thinking>', 'implement feature for session management');
      const sig = warnings.find(w => w.code === 'hallucination_signature');
      expect(sig).toBeDefined();
    });

    it('detects [PROSE] signature', () => {
      const warnings = validatePromptOutput('[PROSE] This is a fictional story', 'write tests for content validation');
      const sig = warnings.find(w => w.code === 'hallucination_signature');
      expect(sig).toBeDefined();
    });

    it('does not flag normal output with relevant content', () => {
      const warnings = validatePromptOutput(
        'Fixed the authentication middleware bug in session.ts',
        'fix the authentication middleware bug'
      );
      const sig = warnings.find(w => w.code === 'hallucination_signature');
      expect(sig).toBeUndefined();
    });
  });

  describe('low relevance detection', () => {
    it('flags output with zero word overlap', () => {
      const warnings = validatePromptOutput(
        'The weather in Lisbon is beautiful today with sunshine and warm temperatures',
        'refactor the authentication middleware for better session handling'
      );
      const lowRel = warnings.find(w => w.code === 'low_relevance');
      expect(lowRel).toBeDefined();
    });

    it('does not flag output with reasonable overlap', () => {
      const warnings = validatePromptOutput(
        'Refactored the authentication middleware to use JWT tokens for better session handling',
        'refactor the authentication middleware for better session handling'
      );
      const lowRel = warnings.find(w => w.code === 'low_relevance');
      expect(lowRel).toBeUndefined();
    });
  });

  describe('empty output', () => {
    it('flags empty string result', () => {
      const warnings = validatePromptOutput('', 'fix the bug');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('empty_output');
    });

    it('flags null result', () => {
      const warnings = validatePromptOutput(null, 'fix the bug');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('empty_output');
    });

    it('flags undefined result', () => {
      const warnings = validatePromptOutput(undefined, 'fix the bug');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('empty_output');
    });
  });

  describe('structured result extraction', () => {
    it('extracts text from { text: "..." }', () => {
      const warnings = validatePromptOutput({ text: '[TRACE] hallucinated output' }, 'fix critical authentication typescript');
      const sig = warnings.find(w => w.code === 'hallucination_signature');
      expect(sig).toBeDefined();
    });

    it('extracts text from content array', () => {
      const warnings = validatePromptOutput(
        { content: [{ type: 'text', text: 'Fixed the authentication bug in middleware' }] },
        'fix the authentication bug in middleware'
      );
      const sig = warnings.find(w => w.code === 'hallucination_signature');
      expect(sig).toBeUndefined();
    });
  });

  describe('extractResultText (unit)', () => {
    it('returns string directly', () => {
      expect(extractResultText('hello')).toBe('hello');
    });

    it('extracts from { text }', () => {
      expect(extractResultText({ text: 'world' })).toBe('world');
    });

    it('extracts from { content: string }', () => {
      expect(extractResultText({ content: 'foo' })).toBe('foo');
    });

    it('extracts from { content: [{text}] }', () => {
      expect(extractResultText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('a b');
    });

    it('returns empty for null', () => {
      expect(extractResultText(null)).toBe('');
    });

    it('returns empty for undefined', () => {
      expect(extractResultText(undefined)).toBe('');
    });
  });

  describe('HALLUCINATION_SIGNATURES export', () => {
    it('exports readonly signature array', () => {
      expect(HALLUCINATION_SIGNATURES.length).toBeGreaterThanOrEqual(5);
      for (const pattern of HALLUCINATION_SIGNATURES) {
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });
  });
});

/**
 * Issue #3853: ACP content validation — hallucination detection tests
 */
import { describe, it, expect } from 'vitest';

const HALLUCINATION_SIGNATURES = [
  /\[TRACE\]/i,
  /\[THINKING\]/i,
  /<thinking>/i,
  /\[PROSE\]/i,
  /\[INTERNAL_MONOLOGUE\]/i,
];

interface PromptValidationWarning {
  code: string;
  message: string;
}

function validatePromptOutput(
  result: unknown,
  originalPrompt: string
): PromptValidationWarning[] {
  const warnings: PromptValidationWarning[] = [];
  const resultText = extractResultText(result);
  if (!resultText) {
    warnings.push({ code: 'empty_output', message: 'Prompt response contains no text output' });
    return warnings;
  }
  for (const pattern of HALLUCINATION_SIGNATURES) {
    if (pattern.test(resultText)) {
      warnings.push({
        code: 'hallucination_signature',
        message: `Output contains known hallucination pattern: ${pattern.source}`,
      });
      break;
    }
  }
  const promptWords = new Set(
    originalPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  if (promptWords.size > 0) {
    const outputWords = new Set(resultText.toLowerCase().split(/\s+/));
    const overlap = [...promptWords].filter(w => outputWords.has(w));
    const overlapRatio = overlap.length / promptWords.size;
    if (overlapRatio < 0.05) {
      warnings.push({
        code: 'low_relevance',
        message: `Output has near-zero word overlap with prompt (${Math.round(overlapRatio * 100)}%). Possible hallucination.`,
      });
    }
  }
  return warnings;
}

function extractResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
    if (Array.isArray(obj.content)) {
      return obj.content
        .filter((b: unknown) => typeof b === 'object' && b !== null && 'text' in (b as Record<string, unknown>))
        .map((b) => (b as Record<string, unknown>).text)
        .join(' ');
    }
    const json = JSON.stringify(result);
    return json.length > 5000 ? json.slice(0, 5000) : json;
  }
  return '';
}

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
});

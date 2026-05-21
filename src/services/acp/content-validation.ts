/**
 * content-validation.ts — ACP output hallucination detection.
 *
 * Shared module used by both production code (backend.ts) and tests.
 * Extracted from duplicated implementations per issue #3896.
 *
 * Originally introduced in PR #3871 (issue #3853).
 */

/**
 * Known hallucination patterns in ACP agent output.
 * These signatures indicate the model is leaking internal reasoning
 * traces or generating fictional content instead of real tool output.
 */
export const HALLUCINATION_SIGNATURES: readonly RegExp[] = [
  /\[TRACE\]/i,
  /\[THINKING\]/i,
  /<thinking>/i,
  /\[PROSE\]/i,
  /\[INTERNAL_MONOLOGUE\]/i,
];

/**
 * A single validation warning from prompt output inspection.
 */
export interface PromptValidationWarning {
  code: 'empty_output' | 'hallucination_signature' | 'low_relevance';
  message: string;
}

/**
 * Extract plain text from various ACP result shapes.
 *
 * Handles: string, { text }, { content: string }, { content: [{text}] },
 * and falls back to JSON.stringify for small objects.
 */
export function extractResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
    if (Array.isArray(obj.content)) {
      return obj.content
        .filter((b: unknown) => typeof b === 'object' && b !== null && 'text' in (b as Record<string, unknown>))
        .map((b) => (b as Record<string, unknown>).text as string)
        .join(' ');
    }
    const json = JSON.stringify(result);
    return json.length > 5000 ? json.slice(0, 5000) : json;
  }
  return '';
}

/**
 * Validate ACP prompt output for hallucination indicators.
 *
 * Checks for:
 * 1. Empty output
 * 2. Known hallucination signatures (leaked reasoning traces)
 * 3. Near-zero word overlap with original prompt (irrelevant output)
 *
 * @param result - The ACP response result (string, object, or structured content)
 * @param originalPrompt - The original prompt text for relevance checking
 * @returns Array of validation warnings (empty if output looks clean)
 */
export function validatePromptOutput(
  result: unknown,
  originalPrompt: string,
): PromptValidationWarning[] {
  const warnings: PromptValidationWarning[] = [];

  const resultText = extractResultText(result);
  if (!resultText) {
    warnings.push({ code: 'empty_output', message: 'Prompt response contains no text output' });
    return warnings;
  }

  // Check for known hallucination signatures
  for (const pattern of HALLUCINATION_SIGNATURES) {
    if (pattern.test(resultText)) {
      warnings.push({
        code: 'hallucination_signature',
        message: `Output contains known hallucination pattern: ${pattern.source}`,
      });
      break; // one match is enough
    }
  }

  // Check for zero word overlap with original prompt (indicates irrelevant output)
  const promptWords = new Set(
    originalPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 3),
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

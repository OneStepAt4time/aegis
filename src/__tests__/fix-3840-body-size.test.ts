/**
 * Issue #3840: no request body size limit — regression tests
 *
 * Validates that the createSession Zod schema rejects prompts > 100K chars
 * and accepts prompts at the boundary.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Replicate the prompt validation from sessions.ts (z.string().min(1).max(100_000))
const promptSchema = z.string().min(1).max(100_000);

describe('Request body size limits (#3840)', () => {
  it('rejects prompt > 100K characters', () => {
    const result = promptSchema.safeParse('x'.repeat(100_001));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue.code).toBe('too_big');
      expect(issue.path).toHaveLength(0); // root-level
    }
  });

  it('accepts prompt at exactly 100K characters', () => {
    const result = promptSchema.safeParse('x'.repeat(100_000));
    expect(result.success).toBe(true);
  });

  it('accepts prompt at 1 character (minimum)', () => {
    const result = promptSchema.safeParse('x');
    expect(result.success).toBe(true);
  });

  it('rejects empty prompt', () => {
    const result = promptSchema.safeParse('');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].code).toBe('too_small');
    }
  });
});

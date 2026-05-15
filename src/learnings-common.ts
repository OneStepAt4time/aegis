/**
 * learnings-common.ts — Shared types and validation for learning systems.
 *
 * Used by both Memory Bridge (memory-bridge-learning.ts) and
 * Structured Learnings (structured-learnings.ts) to prevent drift.
 */

export type LearningType = 'pattern' | 'pitfall' | 'preference' | 'architecture' | 'tool';
export type LearningSource = 'auto' | 'agent-stated' | 'user-stated' | 'human-correction';

export const KEY_MIN_WORDS = 2;
export const KEY_MAX_WORDS = 5;
export const AUTO_CAPTURE_CONFIDENCE_GATE = 7;

export function isValidLearningKey(key: string): boolean {
  const words = key.split('-');
  return words.length >= KEY_MIN_WORDS && words.length <= KEY_MAX_WORDS && /^[a-z0-9-]+$/.test(key);
}

export function isValidConfidence(confidence: number): boolean {
  return Number.isInteger(confidence) && confidence >= 1 && confidence <= 10;
}

export function isRelativePath(path: string): boolean {
  return !path.startsWith('/') && !path.startsWith('\\') && !path.includes('..');
}

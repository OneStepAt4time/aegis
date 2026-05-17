/**
 * utils/session-name.ts — Generate human-friendly session display names.
 *
 * Derives a short, readable name from the user's prompt by extracting
 * the first verb-noun pair. Falls back to a slug of the first few words.
 *
 * Example:
 *   "Build a REST API for user management" → "build-rest-api"
 *   "Fix the flaky test in SessionTable"   → "fix-flaky-test"
 *   "Hello"                                → "hello"
 */

// Common verbs to detect at the start of prompts
const PROMPT_VERBS = new Set([
  'build', 'create', 'make', 'implement', 'add', 'write', 'develop',
  'fix', 'debug', 'resolve', 'repair', 'patch', 'solve',
  'refactor', 'clean', 'remove', 'delete', 'replace', 'update',
  'test', 'validate', 'verify', 'check',
  'deploy', 'ship', 'release', 'publish',
  'design', 'architect', 'plan', 'sketch',
  'optimize', 'improve', 'enhance', 'speed',
  'migrate', 'upgrade', 'port', 'convert',
  'review', 'audit', 'analyze', 'investigate',
  'setup', 'configure', 'install', 'init',
  'document', 'explain', 'describe',
]);

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'for', 'of', 'with', 'to',
  'from', 'by', 'and', 'or', 'is', 'are', 'was', 'were', 'be',
  'that', 'this', 'it', 'its', 'my', 'our', 'your', 'their',
]);

/**
 * Extract a verb-noun phrase from a prompt and format as a session name.
 * Returns a slug like "build-rest-api" or "fix-session-table".
 * Falls back to the first 3 meaningful words if no verb is found.
 */
export function deriveSessionName(prompt: string): string {
  if (!prompt || !prompt.trim()) return 'untitled';

  // Lowercase, strip leading/trailing whitespace
  const text = prompt.trim().toLowerCase();

  // Tokenize: split on whitespace and punctuation, keep only alphanumeric
  const tokens = text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0 && !STOP_WORDS.has(t));

  if (tokens.length === 0) return 'untitled';

  // If first token is a known verb, take verb + next 2 meaningful words
  if (PROMPT_VERBS.has(tokens[0])) {
    const parts = tokens.slice(0, 3); // verb + up to 2 nouns
    return parts.join('-');
  }

  // Otherwise take first 3 meaningful words
  return tokens.slice(0, 3).join('-');
}

/**
 * Generate a full session name with prefix and short ID.
 * Format: `cc-<derived-name>-<4-char-id>`
 */
export function generateSessionName(prompt: string, sessionIdPrefix?: string): string {
  const base = deriveSessionName(prompt);
  if (!sessionIdPrefix) return `cc-${base}`;
  return `cc-${base}-${sessionIdPrefix}`;
}

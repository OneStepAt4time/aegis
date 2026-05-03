/**
 * utils/sanitizeErrorMessage.ts — Sanitize backend error messages for user display.
 *
 * Raw backend errors (Zod validation failures, Fastify schema errors, etc.)
 * often contain technical details that confuse users: "Invalid input",
 * JSON paths, internal field names. This utility extracts a user-friendly
 * message or falls back to a generic one.
 */

/** Known technical patterns to strip or replace. */
const TECHNICAL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Zod validation: "Invalid input, Invalid input, Invalid input"
  { pattern: /^(Invalid input(?:,\s*Invalid input)*)$/i, replacement: 'The data returned by the server was invalid. Please try again.' },
  // JSON path references: "/body/name"
  { pattern: /"\/[^"]+"/g, replacement: '' },
  // Enum values: "Expected 'admin' | 'operator' | 'viewer'"
  { pattern: /Expected\s+'[^']+'(\s*\|\s*'[^']+')+/g, replacement: 'a valid value' },
  // Internal error codes: "UNAUTHORIZED", "FORBIDDEN"
  { pattern: /\b(ERROR|FAIL|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|INTERNAL)\b:\s*/gi, replacement: '' },
];

/**
 * Sanitize a raw error message for display to end users.
 * Returns a user-friendly string, never raw technical output.
 */
export function sanitizeErrorMessage(raw: unknown, fallback?: string): string {
  const defaultFallback = fallback ?? 'An unexpected error occurred.';
  if (!raw) return defaultFallback;

  const message = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : 'An unexpected error occurred.';

  // If the message is very short and technical, replace entirely
  if (message.length < 30 && /^[A-Z_]+$/.test(message.trim())) {
    return fallback ?? 'Something went wrong. Please try again.';
  }

  // Apply known pattern replacements
  let sanitized = message;
  for (const { pattern, replacement } of TECHNICAL_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  // Clean up leftover whitespace and punctuation artifacts
  sanitized = sanitized.replace(/\s{2,}/g, ' ').replace(/^[,;\s]+|[,;\s]+$/g, '').trim();

  // If sanitization removed everything, provide a fallback
  if (!sanitized || sanitized.length < 5) {
    return fallback ?? 'Something went wrong. Please try again.';
  }

  // Cap length to prevent wall-of-text errors
  if (sanitized.length > 200) {
    sanitized = sanitized.slice(0, 197) + '...';
  }

  return sanitized;
}

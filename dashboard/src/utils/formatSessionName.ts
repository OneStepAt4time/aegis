/**
 * utils/formatSessionName.ts — Format session display names for readability.
 *
 * The backend sends slugified prompts as displayName (e.g. "cc-say-pong--nothing-el").
 * This utility cleans them up for human-readable display.
 */

/** Maximum displayed name length before truncation. */
const MAX_DISPLAY_LENGTH = 50;

/**
 * Format a session display name for human-readable display.
 *
 * - Strips "cc-" prefix (Claude Code artifact)
 * - Replaces dashes/hyphens with spaces
 * - Collapses multiple spaces
 * - Title-cases the result
 * - Truncates to ~50 chars with ellipsis
 *
 * @param displayName - Raw displayName from the backend
 * @param fallback - Fallback if displayName is empty (defaults to "Untitled Session")
 * @returns Formatted session name
 */
export function formatSessionName(
  displayName: string | undefined | null,
  fallback = 'Untitled Session',
): string {
  if (!displayName) return fallback;

  let name = displayName;

  // Strip common prefixes
  name = name.replace(/^cc-/, '');

  // Replace dashes and hyphens with spaces
  name = name.replace(/[-_]/g, ' ');

  // Collapse multiple spaces
  name = name.replace(/\s+/g, ' ').trim();

  // Title case
  name = name.replace(/\b\w/g, (c) => c.toUpperCase());

  // If the cleaned name is empty or too short, return fallback
  if (name.length < 2) return fallback;

  // Truncate
  if (name.length > MAX_DISPLAY_LENGTH) {
    name = name.slice(0, MAX_DISPLAY_LENGTH).trimEnd() + '…';
  }

  return name;
}

/**
 * Returns the full unformatted name for tooltips.
 * Still strips the cc- prefix but keeps the rest intact.
 */
export function getFullSessionName(
  displayName: string | undefined | null,
  fallback = 'Untitled Session',
): string {
  if (!displayName) return fallback;
  return displayName.replace(/^cc-/, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

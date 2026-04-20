/**
 * mcp/prompt-sanitizer.ts — Input validators for MCP prompt arguments.
 *
 * Issue #1925: the 3 MCP prompts (implement_issue, review_pr, debug_session)
 * interpolate user-supplied strings into instructions that the host LLM
 * then executes. Without validation, an attacker who controls any of these
 * fields can smuggle fake tool-invocation markers, fence-breaks, or
 * follow-up instructions into the rendered prompt.
 *
 * This module rejects hostile inputs at the boundary. Each field has a
 * narrow format; validation is whitelist-based rather than attempting to
 * escape arbitrary content.
 *
 * Threat vectors covered (see docs/architecture.md "Threat model: MCP prompts"):
 *   - fence-break injection (``` closers, tool_use markers)
 *   - control characters and newlines that break template structure
 *   - Unicode bidi overrides, zero-width joiners, line/paragraph separators
 *   - oversized blobs that bury adversarial text past a truncation window
 *   - path-traversal-style workDir payloads
 */

import { containsTraversalSegment, UUID_REGEX } from '../validation.js';

/** Thrown when a prompt argument fails validation. */
export class PromptInputError extends Error {
  public readonly field: string;
  public readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Invalid prompt argument "${field}": ${reason}`);
    this.name = 'PromptInputError';
    this.field = field;
    this.reason = reason;
  }
}

// ── Length caps ────────────────────────────────────────────────────────

export const MAX_ISSUE_NUMBER_LEN = 10;
export const MAX_REPO_FIELD_LEN = 100;
export const MAX_WORK_DIR_LEN = 1024;

// ── Character-class helpers ────────────────────────────────────────────

/**
 * Control characters and Unicode separators that break line-oriented prompt
 * templates or enable bidi/zero-width smuggling.
 *
 *   \x00-\x1F \x7F  C0 controls + DEL
 *   \u2028 \u2029   line / paragraph separators
 *   \u202A-\u202E   bidi embedding / override
 *   \u2066-\u2069   bidi isolate
 *   \u200B-\u200D   zero-width space / joiner / non-joiner
 *   \uFEFF          zero-width no-break space (BOM)
 */
const FORBIDDEN_CHAR_RE =
  /[\x00-\x1F\x7F\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF]/;

/**
 * Substrings that look like MCP / Anthropic tool-invocation markers. If any
 * appear in a field, the payload is attempting to inject a fake tool call.
 * Matching is case-insensitive and whitespace-tolerant.
 */
const TOOL_INVOCATION_MARKERS = [
  /<\s*tool_use\b/i,
  /<\s*\/\s*tool_use\s*>/i,
  /<\s*tool_result\b/i,
  /<\s*function_calls\b/i,
  /<\s*invoke\b/i,
  /"type"\s*:\s*"tool_use"/i,
  /"type"\s*:\s*"tool_result"/i,
];

const MCP_TOOL_NAMES = [
  'list_sessions',
  'get_status',
  'get_transcript',
  'send_message',
  'create_session',
  'kill_session',
  'approve_permission',
  'reject_permission',
  'server_health',
  'escape_session',
  'interrupt_session',
  'capture_pane',
  'get_session_metrics',
  'get_session_summary',
  'send_bash',
  'send_command',
  'get_session_latency',
  'batch_create_sessions',
  'list_pipelines',
  'create_pipeline',
  'get_swarm',
  'state_set',
  'state_get',
  'state_delete',
];

const MCP_TOOL_NAME_MARKERS = MCP_TOOL_NAMES.map(
  (toolName) => new RegExp(`\\b${toolName}\\b`, 'i'),
);

const HOSTILE_MARKERS = [
  ...TOOL_INVOCATION_MARKERS,
  ...MCP_TOOL_NAME_MARKERS,
];

/** Triple-backtick or triple-tilde (any length ≥3) used to close or reopen code fences. */
const FENCE_RE = /(`|~){3,}/;

function assertNoHostileMarkers(field: string, value: string): void {
  if (FORBIDDEN_CHAR_RE.test(value)) {
    throw new PromptInputError(field, 'contains control or bidi characters');
  }
  if (FENCE_RE.test(value)) {
    throw new PromptInputError(field, 'contains a code fence marker');
  }
  for (const pattern of HOSTILE_MARKERS) {
    if (pattern.test(value)) {
      throw new PromptInputError(field, 'contains a tool-invocation-like marker');
    }
  }
}

// ── Per-field validators ───────────────────────────────────────────────

/** Digits only, 1-10 characters. */
export function validateIssueOrPrNumber(field: string, value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PromptInputError(field, 'must be a non-empty string');
  }
  if (value.length > MAX_ISSUE_NUMBER_LEN) {
    throw new PromptInputError(field, `exceeds ${MAX_ISSUE_NUMBER_LEN} characters`);
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new PromptInputError(field, 'must be a positive integer');
  }
  return value;
}

/** RFC 4122 UUID (any version). */
export function validateSessionId(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PromptInputError('sessionId', 'must be a non-empty string');
  }
  assertNoHostileMarkers('sessionId', value);
  if (!UUID_REGEX.test(value)) {
    throw new PromptInputError('sessionId', 'must be a UUID');
  }
  return value;
}

/**
 * GitHub owner/repo name.
 *
 * GitHub's own rules: alnum, `-`, `.`, `_`; cannot start/end with `.` or `-`;
 * max 39 chars for users / 100 for repos. We use 100 as a single cap.
 */
export function validateRepoField(field: string, value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PromptInputError(field, 'must be a non-empty string');
  }
  if (value.length > MAX_REPO_FIELD_LEN) {
    throw new PromptInputError(field, `exceeds ${MAX_REPO_FIELD_LEN} characters`);
  }
  assertNoHostileMarkers(field, value);
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new PromptInputError(field, 'must contain only [A-Za-z0-9._-]');
  }
  if (/^[.-]/.test(value) || /[.-]$/.test(value)) {
    throw new PromptInputError(field, 'must not start or end with "." or "-"');
  }
  return value;
}

/**
 * Working directory path. Allows Unix and Windows absolute/relative paths
 * but rejects control characters, bidi overrides, newlines, path traversal,
 * code fences, and tool-invocation markers before interpolation into a prompt.
 */
export function validateWorkDir(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PromptInputError('workDir', 'must be a non-empty string');
  }
  if (value.length > MAX_WORK_DIR_LEN) {
    throw new PromptInputError('workDir', `exceeds ${MAX_WORK_DIR_LEN} characters`);
  }
  if (containsTraversalSegment(value)) {
    throw new PromptInputError('workDir', 'must not contain path traversal components (..)');
  }
  assertNoHostileMarkers('workDir', value);
  return value;
}

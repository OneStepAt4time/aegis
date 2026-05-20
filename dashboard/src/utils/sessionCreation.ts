/**
 * Shared constants for session creation across all entry points.
 * Extracted to ensure consistency between Modal, Drawer, Page, and Template flows.
 *
 * NOTE: `clipboardOnly` is NOT a backend-accepted permission mode.
 * It was incorrectly listed in some entry points. Use `bypassPermissions` instead.
 */

/** Permission modes accepted by the Aegis API (POST /v1/sessions) */
export const PERMISSION_MODES = [
  { value: 'default', label: 'Default (prompt)' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
  { value: 'auto', label: 'Auto-accept' },
  { value: 'dontAsk', label: "Don't Ask" },
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number]['value'];

/**
 * Validate that a working directory path looks like a valid absolute path.
 * Allows: /foo, /foo/bar, /foo/../bar, C:\foo (Windows)
 * Rejects: empty, relative paths without leading /, common mistakes
 */
export function validateWorkDir(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return 'Working directory is required';

  // Must start with / (Unix) or drive letter (Windows)
  if (!trimmed.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return 'Working directory must be an absolute path (e.g. /home/user/project)';
  }

  // Reject obviously wrong patterns
  if (trimmed.includes('  ')) {
    return 'Path contains multiple consecutive spaces';
  }

  // Reject control characters
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return 'Path contains invalid characters';
  }

  return null; // valid
}

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

/**
 * config/auth.ts — Zod schema for auth & security config.
 *
 * Covers: authToken, clientAuthToken, permission mode, RBAC, session approval,
 * metrics token, hook secret enforcement, key rotation grace.
 */

import { z } from 'zod';

/** Zod schema for auth/security config domain. */
export const authConfigSchema = z.object({
  /** Bearer auth token (empty = no auth). */
  authToken: z.string().default(''),
  /** Plaintext API token stored for local CLI/dashboard bootstrap flows. */
  clientAuthToken: z.string().optional(),
  /** Default permission mode for new sessions (default: "default"). */
  defaultPermissionMode: z.enum([
    'default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'auto',
  ]).default('default'),
  /** Require X-Hook-Secret header and reject query param secrets. */
  hookSecretHeaderOnly: z.boolean().default(false),
  /** Dedicated token for Prometheus /metrics scrape auth. */
  metricsToken: z.string().default(''),
  /** Enforce session ownership on action routes (default: true). */
  enforceSessionOwnership: z.boolean().default(true),
  /** Enforce RBAC role checks even when auth is disabled (default: false). */
  strictRBAC: z.boolean().default(false),
  /** Require explicit session approval before CC starts (default: false). */
  requireSessionApproval: z.boolean().optional().default(false),
  /** Timeout in ms before auto-rejecting an awaiting_approval session. Default: 300000 (5 min). */
  sessionApprovalTimeoutMs: z.number().int().positive().optional().default(300_000),
  /** Grace period in seconds for key rotation. Both old and new keys work during this window. Default: 3600 (1h). */
  keyRotationGraceSeconds: z.number().int().nonnegative().default(3600),
});

/** Inferred type for the auth config domain. */
export type AuthConfig = z.infer<typeof authConfigSchema>;

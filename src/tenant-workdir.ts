/**
 * tenant-workdir.ts — Tenant-scoped workdir path validation.
 *
 * Issue #1945: Each tenant's sessions are scoped to a tenant-specific
 * workdir root. Cross-tenant path attempts fail closed with an audited
 * rejection.
 *
 * Master tokens (tenantId === undefined) bypass all restrictions.
 * Tenants without a configured root fall back to unrestricted (backward compat).
 */

import { resolve, relative } from 'node:path';
import type { Config } from './config.js';

export interface WorkdirValidationResult {
  allowed: boolean;
  resolvedPath: string;
  reason?: string;
}

/**
 * Validate that a requested workdir path is within the tenant's allowed root.
 *
 * @param tenantId - The tenant ID from the API key (undefined = master token)
 * @param requestedPath - The workDir requested for the session
 * @param config - Aegis config (contains tenantWorkdirs map)
 * @returns Validation result with resolved path and optional rejection reason
 */
export function validateWorkdirPath(
  tenantId: string | undefined,
  requestedPath: string,
  config: Pick<Config, 'tenantWorkdirs'>,
): WorkdirValidationResult {
  const resolvedPath = resolve(requestedPath);

  // Master tokens (no tenantId) bypass all workdir restrictions
  if (tenantId === undefined) {
    return { allowed: true, resolvedPath };
  }

  // Look up tenant workdir configuration
  const tenantWorkdirs = config.tenantWorkdirs ?? {};
  const tenantConfig = tenantWorkdirs[tenantId];

  // No config for this tenant = unrestricted (backward compatible)
  if (!tenantConfig) {
    return { allowed: true, resolvedPath };
  }

  // Resolve the tenant root for consistent comparison
  const tenantRoot = resolve(tenantConfig.root);

  // Check if the resolved path is under the tenant root
  const relativePath = relative(tenantRoot, resolvedPath);

  // If relative path starts with '..', the path escapes the tenant root
  if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
    return {
      allowed: false,
      resolvedPath,
      reason: `workDir "${resolvedPath}" is outside tenant "${tenantId}" root "${tenantRoot}"`,
    };
  }

  // If allowedPaths is configured, additionally check against the allowlist
  if (tenantConfig.allowedPaths && tenantConfig.allowedPaths.length > 0) {
    const allowed = tenantConfig.allowedPaths.some((allowedPath) => {
      const resolvedAllowed = resolve(tenantRoot, allowedPath);
      const rel = relative(resolvedAllowed, resolvedPath);
      return !rel.startsWith('..') && !rel.startsWith('/');
    });

    if (!allowed) {
      return {
        allowed: false,
        resolvedPath,
        reason: `workDir "${resolvedPath}" is not in tenant "${tenantId}" allowed paths`,
      };
    }
  }

  return { allowed: true, resolvedPath };
}

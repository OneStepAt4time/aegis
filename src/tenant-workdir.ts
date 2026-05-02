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

import * as path from 'node:path';
import type { Config } from './config.js';

export interface WorkdirValidationResult {
  allowed: boolean;
  resolvedPath: string;
  reason?: string;
}

type PathOps = typeof path.posix;

function getPathOps(...paths: Array<string | undefined>): PathOps {
  return paths.some(candidate => candidate?.startsWith('/')) ? path.posix : path.win32;
}

function escapesRoot(relativePath: string, pathOps: PathOps): boolean {
  return relativePath === '..'
    || relativePath.startsWith(`..${pathOps.sep}`)
    || pathOps.isAbsolute(relativePath);
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
  const tenantRootInput = tenantId === undefined
    ? undefined
    : config.tenantWorkdirs?.[tenantId]?.root;
  const pathOps = getPathOps(requestedPath, tenantRootInput);
  const resolvedPath = pathOps.resolve(requestedPath);

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
  const tenantRoot = pathOps.resolve(tenantConfig.root);

  // Check if the resolved path is under the tenant root
  const relativePath = pathOps.relative(tenantRoot, resolvedPath);

  // If relative path starts with '..', the path escapes the tenant root
  if (escapesRoot(relativePath, pathOps)) {
    return {
      allowed: false,
      resolvedPath,
      reason: `workDir "${resolvedPath}" is outside tenant "${tenantId}" root "${tenantRoot}"`,
    };
  }

  // If allowedPaths is configured, additionally check against the allowlist
  if (tenantConfig.allowedPaths && tenantConfig.allowedPaths.length > 0) {
    const allowed = tenantConfig.allowedPaths.some((allowedPath) => {
      const resolvedAllowed = pathOps.resolve(tenantRoot, allowedPath);
      const rel = pathOps.relative(resolvedAllowed, resolvedPath);
      return !escapesRoot(rel, pathOps);
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

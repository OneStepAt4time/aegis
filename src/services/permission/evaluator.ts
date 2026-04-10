import { existsSync, realpathSync } from 'node:fs';
import { normalize, sep } from 'node:path';
import type {
  PermissionEvaluationInput,
  PermissionEvaluationResult,
  PermissionProfile,
} from './types.js';

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function extractCandidatePaths(toolInput?: Record<string, unknown>): string[] {
  if (!toolInput) return [];
  const values = [toolInput.path, toolInput.file_path, toolInput.target, ...(Array.isArray(toolInput.paths) ? toolInput.paths : [])];
  return values.filter((v): v is string => typeof v === 'string');
}

function extractContentSize(toolInput?: Record<string, unknown>): number | null {
  const content = toolInput?.content;
  return typeof content === 'string' ? content.length : null;
}

function isLikelyWriteTool(toolName: string): boolean {
  return /write|edit|delete|rename|move|create/i.test(toolName);
}

/**
 * Resolve a path to its real (canonical) form, stripping any symlinks.
 * Falls back to `normalize()` when the path does not exist on disk.
 */
function resolveRealPath(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return normalize(realpathSync(filePath));
    }
  } catch {
    // realpathSync can throw for broken symlinks or permission issues
  }
  return normalize(filePath);
}

function isPathAllowed(candidate: string, allowedPrefixes: string[]): boolean {
  const resolvedCandidate = resolveRealPath(candidate);
  return allowedPrefixes.some((prefix) => {
    const resolvedPrefix = resolveRealPath(prefix);
    return resolvedCandidate === resolvedPrefix ||
      resolvedCandidate.startsWith(resolvedPrefix + sep);
  });
}

export function evaluatePermissionProfile(
  profile: PermissionProfile,
  input: PermissionEvaluationInput,
): PermissionEvaluationResult {
  for (const rule of profile.rules) {
    if (rule.tool !== input.toolName) continue;

    if (rule.pattern) {
      const candidate = typeof input.toolInput?.command === 'string'
        ? input.toolInput.command
        : JSON.stringify(input.toolInput ?? {});
      if (!globToRegExp(rule.pattern).test(candidate)) continue;
    }

    if (rule.constraints?.readOnly && isLikelyWriteTool(input.toolName)) {
      return { behavior: 'deny', reason: `Denied by readOnly constraint for ${input.toolName}` };
    }

    if (rule.constraints?.paths && rule.constraints.paths.length > 0) {
      const paths = extractCandidatePaths(input.toolInput);
      const allowed = paths.every((p) => isPathAllowed(p, rule.constraints!.paths!));
      if (!allowed) {
        return { behavior: 'deny', reason: `Denied by path constraint for ${input.toolName}` };
      }
    }

    if (rule.constraints?.maxFileSize) {
      const size = extractContentSize(input.toolInput);
      if (size !== null && size > rule.constraints.maxFileSize) {
        return { behavior: 'deny', reason: `Denied by maxFileSize constraint for ${input.toolName}` };
      }
    }

    return { behavior: rule.behavior, reason: `Matched rule for ${input.toolName}` };
  }

  return { behavior: profile.defaultBehavior, reason: 'No matching permission rule' };
}

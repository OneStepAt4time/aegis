/**
 * session-env.ts — Environment variable sanitization for session creation.
 *
 * Extracted from SessionManager._createSession (#4246 step 4).
 * Validates and merges session environment variables with strict
 * security checks against injection attacks.
 */

import {
  ENV_NAME_RE,
  ENV_DENYLIST,
  ENV_DANGEROUS_PREFIXES,
  hasControlChars,
  ENV_VALUE_MAX_BYTES,
} from './validation.js';

/**
 * Merge default session env with per-session overrides, applying security validation.
 *
 * Per-session values take precedence over defaults. Each key/value is validated:
 * - Key must match ENV_NAME_RE (uppercase alphanumeric + underscore)
 * - Key must not start with dangerous prefixes (e.g. LD_, npm_config_)
 * - Key must not be in the deny list (PATH, HOME, etc.)
 * - Value must not contain CR/LF or control characters
 * - Value must not exceed ENV_VALUE_MAX_BYTES
 *
 * @throws Error if any env var fails validation
 */
export function sanitizeSessionEnv(
  defaults: Record<string, string>,
  overrides: Record<string, string> | undefined,
): Record<string, string> {
  const DANGEROUS_ENV_VARS = new Set(ENV_DENYLIST);
  const DANGEROUS_ENV_PREFIXES = ENV_DANGEROUS_PREFIXES;
  const mergedEnv: Record<string, string> = {};
  const allEnv = { ...defaults, ...overrides };

  for (const [key, value] of Object.entries(allEnv)) {
    // Issue #1093: Check dangerous prefixes FIRST (before name regex), since some
    // dangerous prefixes like npm_config_ are lowercase and would fail the regex check.
    if (DANGEROUS_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      const matchedPrefix = DANGEROUS_ENV_PREFIXES.find(p => key.startsWith(p))!;
      throw new Error(`Forbidden env var: "${key}" — cannot override dangerous environment variable prefix "${matchedPrefix}"`);
    }
    if (!ENV_NAME_RE.test(key)) {
      throw new Error(`Invalid env var name: "${key}" — must match /^[A-Z_][A-Z0-9_]*$/`);
    }
    if (DANGEROUS_ENV_VARS.has(key)) {
      throw new Error(`Forbidden env var: "${key}" — cannot override dangerous environment variables`);
    }
    // Value hardening (Issue #1908): reject CR/LF and control chars
    if (/[\r\n]/.test(value)) {
      throw new Error(`Forbidden env var value for "${key}" — contains CR/LF characters`);
    }
    if (hasControlChars(value)) {
      throw new Error(`Forbidden env var value for "${key}" — contains control characters`);
    }
    if (Buffer.byteLength(value, 'utf-8') > ENV_VALUE_MAX_BYTES) {
      throw new Error(`Env var "${key}" value exceeds ${ENV_VALUE_MAX_BYTES} byte limit`);
    }
    mergedEnv[key] = value;
  }

  return mergedEnv;
}

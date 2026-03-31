/**
 * redact-headers.ts — Redact sensitive header values for safe logging.
 *
 * Issue #582: Prevent webhook custom headers (Authorization, Cookie, etc.)
 * from leaking into error logs on delivery failures.
 */

/** Header names whose values should be treated as secrets. Case-insensitive. */
const SENSITIVE_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'api-key',
  'apikey',
  'proxy-authorization',
  'x-csrf-token',
  'www-authenticate',
  'proxy-authenticate',
]);

function isSensitive(headerName: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(headerName.toLowerCase());
}

function redactValue(value: string): string {
  if (value.length <= 8) return '[REDACTED]';
  return `${value.slice(0, 4)}...[REDACTED]`;
}

/** Return a copy of `headers` with sensitive values replaced. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = isSensitive(name) ? redactValue(value) : value;
  }
  return result;
}

/**
 * Scrub any sensitive header *values* from arbitrary text.
 * If a fetch error message happens to include a header value, this removes it.
 */
export function redactSecretsFromText(text: string, headers: Record<string, string> | undefined): string {
  if (!headers) return text;
  let result = text;
  for (const [name, value] of Object.entries(headers)) {
    if (!isSensitive(name) || !value) continue;
    // Skip very short values — too many false positives
    if (value.length < 4) continue;
    result = result.replaceAll(value, '[REDACTED]');
  }
  return result;
}

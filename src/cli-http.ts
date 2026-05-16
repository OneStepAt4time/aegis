/**
 * cli-http.ts — Shared HTTP helpers for CLI subcommands.
 *
 * Centralises baseUrl resolution, auth token lookup, and common request
 * patterns so that `ag list`, `ag read`, `ag kill`, `ag status`, and
 * `ag tail` don't duplicate boilerplate.
 */


import { deriveBaseUrl, getConfiguredBaseUrl } from './base-url.js';
import { loadConfig } from './config.js';
import { parseIntSafe } from './validation.js';
import { readAuthTokenFile } from './utils/auth-token-path.js';

export interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}

/** Resolve auth token from env, config, or legacy files. */
export async function resolveAuthToken(): Promise<string> {
  const envToken = process.env.AEGIS_AUTH_TOKEN || process.env.AEGIS_TOKEN;
  if (envToken) return envToken;

  // Auth-token file (respects AEGIS_STATE_DIR — #3511)
  const fileToken = readAuthTokenFile();
  if (fileToken) return fileToken;

  try {
    const config = await loadConfig();
    if (config.clientAuthToken) return config.clientAuthToken;
    if (config.authToken) return config.authToken;
  } catch { /* no config */ }

  return '';
}

/** Resolve base URL from --port flag or config. */
export async function resolveBaseUrl(args: string[]): Promise<string> {
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    return deriveBaseUrl('127.0.0.1', parseIntSafe(args[portIdx + 1], 9100));
  }
  const config = await loadConfig();
  return getConfiguredBaseUrl(config);
}

/** Build headers with optional auth. */
export function buildHeaders(authToken: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return headers;
}

/** Check if the server is reachable. */
export async function isServerHealthy(baseUrl: string, authToken?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/v1/health`, { headers, signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ensure the server is reachable, printing an error and returning false if not. */
export async function requireServer(baseUrl: string, authToken: string, io: CliIO): Promise<boolean> {
  if (!(await isServerHealthy(baseUrl, authToken))) {
    writeLine(io.stderr, `  ❌ Cannot connect to Aegis at ${baseUrl}.`);
    writeLine(io.stderr, '     Start the server first: ag');
    return false;
  }
  return true;
}

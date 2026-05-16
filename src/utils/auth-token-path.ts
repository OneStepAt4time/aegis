/**
 * auth-token-path.ts — Single source of truth for auth token file resolution.
 *
 * Consolidates the 4 scattered locations for the client auth token into
 * a single canonical file path driven by AEGIS_STATE_DIR.
 *
 * Issue #3497.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Returns the canonical auth token file path.
 * Uses AEGIS_STATE_DIR if set, otherwise falls back to ~/.aegis.
 */
export function getAuthTokenFilePath(): string {
  const stateDir = process.env.AEGIS_STATE_DIR || join(homedir(), '.aegis');
  return join(stateDir, 'auth-token');
}

/**
 * Write the auth token to the canonical file with 0600 permissions.
 * Non-fatal on failure.
 */
export function persistAuthTokenFile(token: string): void {
  const tokenPath = getAuthTokenFilePath();
  const tokenDir = join(tokenPath, '..');
  try {
    if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
    writeFileSync(tokenPath, token, { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Non-fatal — token is still in config.yaml as clientAuthToken
  }
}

/**
 * Read the auth token from the canonical file.
 * Returns null if the file does not exist or cannot be read.
 */
export function readAuthTokenFile(): string | null {
  try {
    const token = readFileSync(getAuthTokenFilePath(), 'utf-8').trim();
    return token || null;
  } catch {
    return null;
  }
}

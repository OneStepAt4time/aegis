/**
 * token-store.ts — Read/write ~/.aegis/auth.json for OAuth2 device flow tokens.
 *
 * Token storage keyed by server origin so multi-server is supported from day one.
 * Uses atomic writes (write to .tmp, then rename) and enforces 0o600 permissions.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { secureFilePermissions } from '../../file-utils.js';

/** Stored identity extracted from id_token at login time. */
export interface StoredIdentity {
  sub: string;
  email?: string;
  name?: string;
}

/** Stored token set for one server. */
export interface StoredTokens {
  access: string;
  refresh: string;
  id_token: string;
  expires_at: number; // Unix epoch seconds
  scope: string;
}

/** Full entry stored per server origin. */
export interface StoredAuth {
  idp: string;
  identity: StoredIdentity;
  tokens: StoredTokens;
  role: string;
  obtained_at: string; // ISO 8601
}

/** Top-level auth.json structure — keyed by server origin URL. */
export type AuthStore = Record<string, StoredAuth>;

/** Resolve the auth directory path.
 *  Priority: explicit parameter > AEGIS_AUTH_DIR env var > ~/.aegis/ */
function resolveAuthDir(authDir?: string): string {
  return authDir || process.env.AEGIS_AUTH_DIR || join(homedir(), '.aegis');
}

/** Resolve the auth.json file path. */
export function resolveAuthFilePath(authDir?: string): string {
  return join(resolveAuthDir(authDir), 'auth.json');
}

/** Read the auth store from disk. Returns empty object if file doesn't exist. */
export async function readAuthStore(authDir?: string): Promise<AuthStore> {
  const filePath = resolveAuthFilePath(authDir);
  if (!existsSync(filePath)) return {};

  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as AuthStore;
  } catch {
    return {};
  }
}

/** Write the auth store to disk with atomic write and 0o600 permissions. */
export async function writeAuthStore(store: AuthStore, authDir?: string): Promise<void> {
  const dir = resolveAuthDir(authDir);
  const filePath = join(dir, 'auth.json');
  const tmpPath = `${filePath}.tmp`;

  await mkdir(dir, { recursive: true });

  const content = JSON.stringify(store, null, 2) + '\n';
  await writeFile(tmpPath, content, { mode: 0o600 });
  await rename(tmpPath, filePath);
  await secureFilePermissions(filePath);
}

/** Get stored auth for a specific server origin. */
export async function getStoredAuth(
  serverOrigin: string,
  authDir?: string,
): Promise<StoredAuth | null> {
  const store = await readAuthStore(authDir);
  return store[serverOrigin] ?? null;
}

/** Store auth for a specific server origin (atomic write). */
export async function setStoredAuth(
  serverOrigin: string,
  auth: StoredAuth,
  authDir?: string,
): Promise<void> {
  const store = await readAuthStore(authDir);
  store[serverOrigin] = auth;
  await writeAuthStore(store, authDir);
}

/** Remove stored auth for a specific server origin. */
export async function removeStoredAuth(
  serverOrigin: string,
  authDir?: string,
): Promise<boolean> {
  const store = await readAuthStore(authDir);
  if (!store[serverOrigin]) return false;
  delete store[serverOrigin];

  // If store is empty, delete the file entirely
  if (Object.keys(store).length === 0) {
    const filePath = resolveAuthFilePath(authDir);
    try {
      await unlink(filePath);
    } catch {
      // File may already be gone — ignore
    }
    return true;
  }

  await writeAuthStore(store, authDir);
  return true;
}

/** Delete the entire auth.json file (ag logout --all). */
export async function deleteAuthStore(authDir?: string): Promise<boolean> {
  const filePath = resolveAuthFilePath(authDir);
  if (!existsSync(filePath)) return false;

  try {
    await unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

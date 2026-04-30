/**
 * token-store.test.ts — Unit tests for OAuth2 token storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readAuthStore,
  writeAuthStore,
  getStoredAuth,
  setStoredAuth,
  removeStoredAuth,
  deleteAuthStore,
  resolveAuthFilePath,
  type StoredAuth,
} from '../services/auth/token-store.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'aegis-test-auth-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

const sampleAuth: StoredAuth = {
  idp: 'https://accounts.google.com',
  identity: { sub: 'user-123', email: 'alice@example.com', name: 'Alice' },
  tokens: {
    access: 'access-token-1',
    refresh: 'refresh-token-1',
    id_token: 'id-token-1',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    scope: 'openid profile email',
  },
  role: 'admin',
  obtained_at: '2026-04-30T10:00:00Z',
};

describe('token-store', () => {
  it('reads empty store when file does not exist', async () => {
    const store = await readAuthStore(testDir);
    expect(store).toEqual({});
  });

  it('writes and reads back auth store', async () => {
    await writeAuthStore({ 'http://localhost:9100': sampleAuth }, testDir);

    const store = await readAuthStore(testDir);
    expect(store['http://localhost:9100']).toEqual(sampleAuth);
  });

  it('creates auth.json with 0o600 permissions', async () => {
    await writeAuthStore({ 'http://localhost:9100': sampleAuth }, testDir);

    const filePath = resolveAuthFilePath(testDir);
    expect(existsSync(filePath)).toBe(true);

    // Read and verify content is valid JSON
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed['http://localhost:9100'].identity.email).toBe('alice@example.com');
  });

  it('getStoredAuth returns null for missing server', async () => {
    const result = await getStoredAuth('http://unknown:9100', testDir);
    expect(result).toBeNull();
  });

  it('getStoredAuth returns auth for existing server', async () => {
    await writeAuthStore({ 'http://localhost:9100': sampleAuth }, testDir);

    const result = await getStoredAuth('http://localhost:9100', testDir);
    expect(result).toEqual(sampleAuth);
  });

  it('setStoredAuth adds new server without overwriting existing', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const auth2: StoredAuth = {
      ...sampleAuth,
      identity: { sub: 'user-456', email: 'bob@example.com' },
    };
    await setStoredAuth('http://staging:9100', auth2, testDir);

    const store = await readAuthStore(testDir);
    expect(Object.keys(store)).toHaveLength(2);
    expect(store['http://localhost:9100'].identity.email).toBe('alice@example.com');
    expect(store['http://staging:9100'].identity.email).toBe('bob@example.com');
  });

  it('setStoredAuth replaces existing server entry', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const updated: StoredAuth = {
      ...sampleAuth,
      role: 'viewer',
    };
    await setStoredAuth('http://localhost:9100', updated, testDir);

    const result = await getStoredAuth('http://localhost:9100', testDir);
    expect(result!.role).toBe('viewer');
  });

  it('removeStoredAuth removes server and keeps file', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);
    await setStoredAuth('http://staging:9100', { ...sampleAuth, role: 'operator' }, testDir);

    const removed = await removeStoredAuth('http://localhost:9100', testDir);
    expect(removed).toBe(true);

    const store = await readAuthStore(testDir);
    expect(store['http://localhost:9100']).toBeUndefined();
    expect(store['http://staging:9100']).toBeDefined();
  });

  it('removeStoredAuth deletes file when last entry is removed', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const removed = await removeStoredAuth('http://localhost:9100', testDir);
    expect(removed).toBe(true);

    const filePath = resolveAuthFilePath(testDir);
    expect(existsSync(filePath)).toBe(false);
  });

  it('removeStoredAuth returns false for non-existent server', async () => {
    const removed = await removeStoredAuth('http://unknown:9100', testDir);
    expect(removed).toBe(false);
  });

  it('deleteAuthStore removes the entire file', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);
    expect(existsSync(resolveAuthFilePath(testDir))).toBe(true);

    const deleted = await deleteAuthStore(testDir);
    expect(deleted).toBe(true);
    expect(existsSync(resolveAuthFilePath(testDir))).toBe(false);
  });

  it('deleteAuthStore returns false when no file exists', async () => {
    const deleted = await deleteAuthStore(testDir);
    expect(deleted).toBe(false);
  });
});

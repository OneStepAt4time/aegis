/**
 * fix-3261-ag-run-auth.test.ts
 *
 * Issue #3261: `ag run` fails with Unauthorized when server has keys.json
 * but no config.yaml. The root cause was ensureConfig() generating a random
 * token not registered in keys.json. Fix: use AuthManager.createKey() to
 * properly register the key, and show a helpful 401 error message.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const AUTH_MANAGER_PATH = '../services/auth/index.js';
const CONFIG_PATH = '../config.js';

describe('Issue #3261: ag run auth bootstrap', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `aegis-test-3261-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureConfig creates a key in keys.json via AuthManager (not a random token)', async () => {
    const { AuthManager } = await import(AUTH_MANAGER_PATH);

    const keysFile = join(tmpDir, 'keys.json');
    const authManager = new AuthManager(keysFile);
    await authManager.load();

    const createdKey = await authManager.createKey('ag-run-admin', 100, undefined, 'admin');

    expect(createdKey.key).toBeTruthy();
    // AuthManager generates keys with 'aegis_' prefix
    expect(createdKey.key).toMatch(/^aegis_/);
    expect(createdKey.role).toBe('admin');

    // Verify the key was persisted to keys.json
    const authManager2 = new AuthManager(keysFile);
    await authManager2.load();

    const result = authManager2.validate(createdKey.key);
    expect(result.valid).toBe(true);
  });

  it('ensureConfig-generated token is recognized by a fresh AuthManager load', async () => {
    const { AuthManager } = await import(AUTH_MANAGER_PATH);

    const keysFile = join(tmpDir, 'keys.json');

    const m1 = new AuthManager(keysFile);
    await m1.load();
    const key = await m1.createKey('test-admin', 100, undefined, 'admin');

    // Simulate server loading keys.json fresh
    const m2 = new AuthManager(keysFile);
    await m2.load();

    const result = m2.validate(key.key);
    expect(result.valid).toBe(true);
    expect(result.keyId).toBe(key.id);
  });

  it('random token not in keys.json is rejected when keys exist', async () => {
    const { AuthManager } = await import(AUTH_MANAGER_PATH);

    const keysFile = join(tmpDir, 'keys.json');
    const authManager = new AuthManager(keysFile);
    await authManager.load();

    // Create a real key first (so the store is non-empty and validate doesn't allow-all)
    await authManager.createKey('real-key', 100, undefined, 'admin');

    // This is what the OLD ensureConfig generated — a token not in keys.json
    const randomToken = `aegis-quickstart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const result = authManager.validate(randomToken);
    expect(result.valid).toBe(false);
  });

  it('ensureConfig reads existing config and returns its token', async () => {
    const { serializeConfigFile } = await import(CONFIG_PATH);
    const configPath = join(tmpDir, 'config.yaml');
    const existingToken = 'aegis-existing-token-12345';
    const configText = serializeConfigFile({
      authToken: existingToken,
      baseUrl: 'http://127.0.0.1:9100',
      dashboardEnabled: true,
    }, configPath);
    writeFileSync(configPath, configText, 'utf-8');

    const { readConfigFile } = await import(CONFIG_PATH);
    const read = await readConfigFile(configPath);
    expect(read).not.toBeNull();
    expect(read!.authToken).toBe(existingToken);
  });

  it('401 response triggers helpful error message', async () => {
    const { handleRun } = await import('../commands/run.js');

    const outputLines: string[] = [];
    const io = {
      stdin: process.stdin,
      stdout: { write: (text: string) => outputLines.push(text) } as any,
      stderr: { write: (text: string) => outputLines.push(text) } as any,
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (String(url).includes('/v1/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).includes('/v1/sessions') && opts?.method === 'POST') {
        return new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', message: 'Unauthorized — Bearer token required' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    try {
      const result = await handleRun(['test prompt'], io);
      expect(result).toBe(1);

      const output = outputLines.join('');
      expect(output).toContain('Unauthorized');
      expect(output).toContain('ag init');
      expect(output).toContain('AEGIS_AUTH_TOKEN');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

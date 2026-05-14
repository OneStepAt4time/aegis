/**
 * Issue #3367: Server can enter unrecoverable auth state where all tokens are invalid.
 *
 * After state directory churn (delete + ag init --force), the server should
 * automatically recover by re-reading keys.json from disk on the next
 * validation failure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { AuthManager } from '../services/auth/AuthManager.js';

describe('Issue #3367: Auth state recovery after state directory loss', () => {
  let tmpDir: string;
  let keysFile: string;
  let auth: AuthManager;

  beforeEach(async () => {
    tmpDir = join('/tmp', `test-3367-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    keysFile = join(tmpDir, 'keys.json');
    auth = new AuthManager(keysFile, 'master-secret');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reload() picks up new keys after state dir wipe and recreate', async () => {
    // Step 1: Create initial key
    const { key: oldKey } = await auth.createKey('old-key', 100, undefined, 'admin');
    expect(auth.validate(oldKey).valid).toBe(true);

    // Step 2: Delete keys.json (simulate state dir wipe)
    await rm(keysFile);

    // Step 3: Old key should still work (in-memory)
    expect(auth.validate(oldKey).valid).toBe(true);

    // Step 4: Write new keys.json (simulate ag init --force creating new token)
    const newAuth = new AuthManager(keysFile, 'master-secret');
    const { key: newKey } = await newAuth.createKey('new-key', 100, undefined, 'admin');
    await newAuth.save();

    // Step 5: Old key still works (in-memory), new key doesn't
    expect(auth.validate(oldKey).valid).toBe(true);
    expect(auth.validate(newKey).valid).toBe(false);

    // Step 6: Reload should pick up new keys
    const reloaded = await auth.reload();
    expect(reloaded).toBe(true);

    // Step 7: New key should now work, old key should not
    expect(auth.validate(newKey).valid).toBe(true);
    expect(auth.validate(oldKey).valid).toBe(false);
  });

  it('reload() does nothing if keys.json has not changed', async () => {
    await auth.createKey('test-key', 100, undefined, 'admin');
    await auth.load(); // ensure mtime is tracked
    const reloaded = await auth.reload();
    expect(reloaded).toBe(false);
  });

  it('reload() handles missing keys.json gracefully', async () => {
    const { key: existingKey } = await auth.createKey('graceful-key', 100, undefined, 'admin');
    expect(auth.validate(existingKey).valid).toBe(true);
    await rm(keysFile);
    const reloaded = await auth.reload();
    expect(reloaded).toBe(false);
    expect(auth.validate(existingKey).valid).toBe(true);
    expect(auth.isHealthy()).toBe(false);
  });

  it('reload() is safe to call concurrently', async () => {
    await auth.createKey('test-key', 100, undefined, 'admin');
    const results = await Promise.all([auth.reload(), auth.reload(), auth.reload()]);
    expect(results.every(r => typeof r === 'boolean')).toBe(true);
  });

  it('isHealthy() returns false when keys.json missing but keys exist in memory', async () => {
    await auth.createKey('test-key', 100, undefined, 'admin');
    expect(auth.isHealthy()).toBe(true);
    await rm(keysFile);
    expect(auth.isHealthy()).toBe(false);
  });

  it('isHealthy() returns true when keys.json exists', async () => {
    await auth.createKey('test-key', 100, undefined, 'admin');
    expect(auth.isHealthy()).toBe(true);
  });

  it('isHealthy() returns true when no keys and no file (fresh start)', () => {
    expect(auth.isHealthy()).toBe(true);
  });

  it('save() updates mtime so subsequent reload() is a no-op', async () => {
    await auth.createKey('key1', 100, undefined, 'admin');
    const mtimeAfterSave = statSync(keysFile).mtimeMs;
    const reloaded = await auth.reload();
    expect(reloaded).toBe(false);
  });
});

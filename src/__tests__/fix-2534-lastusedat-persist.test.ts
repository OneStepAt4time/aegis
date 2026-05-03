/**
 * fix-2534-lastusedat-persist.test.ts — Tests for Issue #2534.
 *
 * Bug: lastUsedAt was updated in memory but never persisted to disk.
 * Fix: dirty flag + periodic save during sweepStaleRateLimits().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthManager } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync } from 'node:fs';

describe('Issue #2534: lastUsedAt persisted to disk', () => {
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-test-2534-${Date.now()}.json`);
    auth = new AuthManager(tmpFile, '');
  });

  afterEach(() => {
    try { rmSync(tmpFile); } catch { /* ignore */ }
  });

  it('should persist lastUsedAt after sweep when key is used', async () => {
    const { key } = await auth.createKey('persist-test', 10);

    // Validate to trigger lastUsedAt update in memory
    const result = auth.validate(key);
    expect(result.valid).toBe(true);

    // In-memory update should be nonzero
    const store = (auth as any).store as { keys: Array<{ lastUsedAt: number }> };
    expect(store.keys[0].lastUsedAt).toBeGreaterThan(0);

    // Sweep should persist to disk
    auth.sweepStaleRateLimits();
    // save() is async — wait a tick
    await new Promise((r) => setTimeout(r, 10));

    const onDisk = JSON.parse(readFileSync(tmpFile, 'utf-8'));
    expect(onDisk.keys[0].lastUsedAt).toBeGreaterThan(0);
  });

  it('should NOT persist when no key was used (dirty flag is false)', async () => {
    const { key } = await auth.createKey('no-use-test', 10);
    const before = JSON.parse(readFileSync(tmpFile, 'utf-8'));
    expect(before.keys[0].lastUsedAt).toBe(0);

    // Sweep without any validate calls
    auth.sweepStaleRateLimits();
    await new Promise((r) => setTimeout(r, 10));

    const after = JSON.parse(readFileSync(tmpFile, 'utf-8'));
    // lastUsedAt should still be 0 — no unnecessary write with same value
    // (the dirty flag was never set)
    expect(after.keys[0].lastUsedAt).toBe(0);
  });

  it('should persist lastUsedAt for grace key auth path', async () => {
    const { key: oldKey } = await auth.createKey('grace-test', 10);
    const rotated = await auth.rotateKeyWithGrace(
      (auth as any).store.keys[0].id,
      3600,
    );

    // Authenticate with old key (grace path)
    const result = auth.validate(oldKey);
    expect(result.valid).toBe(true);

    // Sweep should persist the lastUsedAt update from the grace path
    auth.sweepStaleRateLimits();
    await new Promise((r) => setTimeout(r, 10));

    const onDisk = JSON.parse(readFileSync(tmpFile, 'utf-8'));
    expect(onDisk.keys[0].lastUsedAt).toBeGreaterThan(0);
  });

  it('should persist lastUsedAt across load/save cycle', async () => {
    const { key } = await auth.createKey('cycle-test', 10);

    // Validate and sweep to persist
    auth.validate(key);
    auth.sweepStaleRateLimits();
    await new Promise((r) => setTimeout(r, 10));

    const onDisk = JSON.parse(readFileSync(tmpFile, 'utf-8'));
    const persistedTime = onDisk.keys[0].lastUsedAt;
    expect(persistedTime).toBeGreaterThan(0);

    // Load into a new AuthManager and verify lastUsedAt survives
    const auth2 = new AuthManager(tmpFile, '');
    await auth2.load();
    const keys = auth2.listKeys();
    expect(keys[0].lastUsedAt).toBe(persistedTime);
  });
});

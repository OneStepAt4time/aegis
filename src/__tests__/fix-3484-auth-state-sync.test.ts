/**
 * Issue #3484: AuthManager state synchronization fixes.
 *
 *  1. validate() should proactively reload keys.json when its mtime advances,
 *     so a freshly-added key activates on the first request rather than after
 *     a wasted 401 wakes up the post-fail async reload.
 *
 *  2. checkClientToken() should detect when a plaintext token (e.g. from
 *     ~/.aegis/auth-token) is orphaned — i.e. does not match any registered
 *     key nor the master token.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { AuthManager } from '../services/auth/AuthManager.js';

describe('Issue #3484: AuthManager proactive reload + orphan detection', () => {
  let tmpDir: string;
  let keysFile: string;
  let auth: AuthManager;

  beforeEach(async () => {
    tmpDir = join('/tmp', `test-3484-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    keysFile = join(tmpDir, 'keys.json');
    auth = new AuthManager(keysFile, '');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('reloadSyncIfChanged()', () => {
    it('returns false when keys.json has not been modified since last load', async () => {
      await auth.createKey('initial', 100, undefined, 'admin');
      // save() updates lastKeysMtime; immediate check sees no change.
      expect(auth.reloadSyncIfChanged()).toBe(false);
    });

    it('picks up an externally appended key without an explicit reload() call', async () => {
      // Seed with one key via the normal API
      const { key: existing } = await auth.createKey('existing', 100, undefined, 'admin');
      expect(auth.validate(existing).valid).toBe(true);

      // Simulate another writer (e.g. a future SSO provisioner) appending a key
      const raw = await readFile(keysFile, 'utf-8');
      const store = JSON.parse(raw) as { keys: unknown[] };
      // Use AuthManager.hashKey to mirror the production hashing rule.
      const newKeyPlaintext = 'aegis_' + 'a'.repeat(60);
      store.keys.push({
        id: 'externalfeed1234',
        name: 'externally-added',
        hash: AuthManager.hashKey(newKeyPlaintext),
        createdAt: Date.now(),
        lastUsedAt: 0,
        rateLimit: 100,
        expiresAt: null,
        role: 'admin',
        permissions: ['create', 'send', 'approve', 'reject', 'kill'],
        tenantId: '_system',
      });
      await writeFile(keysFile, JSON.stringify(store, null, 2));
      // Force a strictly-newer mtime since some filesystems have second-level granularity.
      const future = new Date(Date.now() + 5_000);
      utimesSync(keysFile, future, future);

      // First call to validate() must already honor the new key — no warm-up 401.
      const result = auth.validate(newKeyPlaintext);
      expect(result.valid).toBe(true);
      expect(result.keyId).toBe('externalfeed1234');
    });

    it('leaves in-memory keys intact when keys.json becomes corrupt', async () => {
      const { key } = await auth.createKey('survivor', 100, undefined, 'admin');
      expect(auth.validate(key).valid).toBe(true);

      await writeFile(keysFile, '{ not valid json');
      const future = new Date(Date.now() + 5_000);
      utimesSync(keysFile, future, future);

      // validate() must not throw and must still recognize the in-memory key.
      const r = auth.validate(key);
      expect(r.valid).toBe(true);
    });
  });

  describe('checkClientToken()', () => {
    it('returns matched=false for the empty string', () => {
      expect(auth.checkClientToken('')).toEqual({ matched: false, via: null });
    });

    it('returns matched=true with via=key for a registered plaintext token', async () => {
      const { key } = await auth.createKey('registered', 100, undefined, 'admin');
      expect(auth.checkClientToken(key)).toEqual({ matched: true, via: 'key' });
    });

    it('returns matched=true with via=master when the token equals the master token', () => {
      const master = 'aegis_master_test_token';
      const a = new AuthManager(keysFile, master);
      expect(a.checkClientToken(master)).toEqual({ matched: true, via: 'master' });
    });

    it('returns matched=false for an orphaned plaintext token', async () => {
      await auth.createKey('only-real-key', 100, undefined, 'admin');
      const orphan = 'aegis_' + 'b'.repeat(60);
      expect(auth.checkClientToken(orphan)).toEqual({ matched: false, via: null });
    });

    it('trims surrounding whitespace before comparing', async () => {
      const { key } = await auth.createKey('whitespace', 100, undefined, 'admin');
      expect(auth.checkClientToken(`  ${key}\n`)).toEqual({ matched: true, via: 'key' });
    });
  });
});

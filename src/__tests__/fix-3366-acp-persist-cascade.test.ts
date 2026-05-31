/**
 * Regression tests for #3366: ACP local storage persist() failure cascade.
 *
 * Bug: FileAcpLocalStorageProfile.persist() chains writes onto writeChain
 * without error recovery. A single failed write poisons all subsequent writes
 * because every .then() chains onto the rejected promise.
 *
 * Fix: persist() now catches errors, resets the chain, and logs the failure.
 * Subsequent writes get a fresh attempt.
 */
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileAcpLocalStorageProfile } from '../services/acp/local-storage.js';

function makeSession(id: string) {
  const now = Date.now();
  return {
    id,
    conversationId: `conv-${id}`,
    transcriptId: `transcript-${id}`,
    tenantId: 'test-tenant',
    ownerKeyId: 'test-key',
    runnerType: 'acp' as const,
    status: 'initializing' as const,
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

describe('Issue #3366: ACP local storage persist() failure cascade', () => {
  let tmpDir: string;
  let filePath: string;

  async function blockStorageDirectory() {
    const storageDir = path.dirname(filePath);
    await fs.promises.rm(storageDir, { recursive: true, force: true });
    await fs.promises.writeFile(storageDir, 'not-a-directory');
  }

  async function restoreStorageDirectory() {
    const storageDir = path.dirname(filePath);
    await fs.promises.rm(storageDir, { force: true });
    await fs.promises.mkdir(storageDir, { recursive: true });
  }

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aegis-3366-'));
    filePath = path.join(tmpDir, 'acp-local-storage.json');
  });

  afterEach(async () => {
    // Restore permissions so cleanup can succeed
    await fs.promises.chmod(tmpDir, 0o755).catch(() => {});
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('recovers from a failed persist — subsequent writes succeed', async () => {
    const profile = createFileAcpLocalStorageProfile({ filePath, persistDebounceMs: 0 });
    await profile.start();
    expect(profile.getPersistError()).toBeNull();

    // Replace the storage directory with a file to force ENOTDIR on all platforms.
    await blockStorageDirectory();

    // Trigger persist via a mutation — should fail silently
    await profile.sessionStore.create(makeSession('fail-1'));
    expect(profile.getPersistError()).not.toBeNull();

    await restoreStorageDirectory();

    // Trigger another mutation — this should SUCCEED (not cascade!)
    await profile.sessionStore.create(makeSession('recover-1'));
    expect(profile.getPersistError()).toBeNull();

    // Verify the file actually contains the data
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.sessions).toHaveLength(2);

    await profile.stop();
  });

  it('does NOT cascade rejection across multiple sequential failures', async () => {
    const profile = createFileAcpLocalStorageProfile({ filePath, persistDebounceMs: 0 });
    await profile.start();

    await blockStorageDirectory();

    // First failed persist
    await profile.sessionStore.create(makeSession('fail-1'));
    expect(profile.getPersistError()).not.toBeNull();

    // Second failed persist — should NOT be chained to rejected promise
    await profile.sessionStore.create(makeSession('fail-2'));
    expect(profile.getPersistError()).not.toBeNull();

    // Third failed persist — still no cascade
    await profile.sessionStore.create(makeSession('fail-3'));
    expect(profile.getPersistError()).not.toBeNull();

    await restoreStorageDirectory();
    await profile.sessionStore.create(makeSession('recover'));
    expect(profile.getPersistError()).toBeNull();

    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.sessions).toHaveLength(4);

    await profile.stop();
  });

  it('stop() does not throw even when writeChain has a rejection', async () => {
    const profile = createFileAcpLocalStorageProfile({ filePath, persistDebounceMs: 0 });
    await profile.start();

    await blockStorageDirectory();
    await profile.sessionStore.create(makeSession('doomed'));

    // stop() should NOT throw — it catches the chain rejection
    await restoreStorageDirectory();
    await expect(profile.stop()).resolves.toBeUndefined();
  });
});

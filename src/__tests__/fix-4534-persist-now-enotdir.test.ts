/**
 * Regression test for PR #4549 local-storage refactor: ensure persistNow
 * swallows write errors (ENOTDIR) and records them in persistError without
 * allowing unhandled rejections to escape the test runner.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileAcpLocalStorageProfile } from '../services/acp/local-storage/index.js';

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

describe('PR #4549: persistNow ENOTDIR does not cause unhandled rejection', () => {
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
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aegis-4534-'));
    filePath = path.join(tmpDir, 'acp-local-storage.json');
  });

  afterEach(async () => {
    await fs.promises.chmod(tmpDir, 0o755).catch(() => {});
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('records persist error but does not let it escape as unhandled rejection', async () => {
    const profile = createFileAcpLocalStorageProfile({ filePath, persistDebounceMs: 0 });
    await profile.start();

    // Replace the storage directory with a file to force ENOTDIR on all platforms.
    await blockStorageDirectory();

    // Trigger persist via a mutation — should fail silently
    await profile.sessionStore.create(makeSession('fail-1'));
    expect(profile.getPersistError()).not.toBeNull();

    // Restore directory and ensure subsequent writes succeed
    await restoreStorageDirectory();
    await profile.sessionStore.create(makeSession('recover-1'));
    expect(profile.getPersistError()).toBeNull();

    // Verify file contains data
    const content = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.sessions).toHaveLength(2);

    await profile.stop();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { testTmpDir } from './helpers/platform.js';

vi.mock('../file-utils.js', () => ({
  secureFilePermissions: vi.fn(),
}));

import { writePidFile } from '../startup.js';

const mockSecureFilePermissions = vi.mocked((await import('../file-utils.js')).secureFilePermissions);

describe('writePidFile', () => {
  let stateDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSecureFilePermissions.mockResolvedValue(undefined);
    stateDir = mkdtempSync(join(testTmpDir(), 'aegis-startup-test-'));
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('writes PID file and applies permission hardening', async () => {
    const pidFilePath = await writePidFile(stateDir);
    expect(pidFilePath).toBe(join(stateDir, 'aegis.pid'));
    expect(readFileSync(pidFilePath, 'utf-8')).toBe(String(process.pid));
    expect(mockSecureFilePermissions).toHaveBeenCalledWith(pidFilePath);

    const perms = statSync(pidFilePath).mode & 0o777;
    if (process.platform === 'win32') {
      expect(perms).toBeGreaterThan(0);
    } else {
      expect(perms).toBe(0o600);
    }
  });

  it('returns empty string if permission hardening fails', async () => {
    mockSecureFilePermissions.mockRejectedValueOnce(new Error('chmod failed'));
    await expect(writePidFile(stateDir)).resolves.toBe('');
  });
});

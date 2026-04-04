import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    chmod: vi.fn(),
  };
});

import { buildWindowsIcaclsArgs, secureFilePermissions } from '../file-utils.js';

const mockExecFile = vi.mocked((await import('node:child_process')).execFile);
const mockChmod = vi.mocked((await import('node:fs/promises')).chmod);

describe('file-utils', () => {
  const originalUser = process.env.USERNAME;
  const originalDomain = process.env.USERDOMAIN;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.USERNAME = originalUser;
    process.env.USERDOMAIN = originalDomain;
  });

  it('applies chmod 600 on non-Windows platforms', async () => {
    await secureFilePermissions('/tmp/sensitive.txt', 'linux');
    expect(mockChmod).toHaveBeenCalledWith('/tmp/sensitive.txt', 0o600);
  });

  it('builds icacls arguments for current user access', () => {
    const args = buildWindowsIcaclsArgs('C:\\tmp\\secret.txt', 'DOMAIN\\alice');
    expect(args).toEqual([
      'C:\\tmp\\secret.txt',
      '/inheritance:r',
      '/grant:r',
      'DOMAIN\\alice:(R,W)',
    ]);
  });

  it('uses icacls on Windows and does not throw on failure', async () => {
    process.env.USERNAME = 'alice';
    process.env.USERDOMAIN = 'DOMAIN';
    mockExecFile.mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (error: Error | null) => void)(new Error('icacls unavailable'));
    }) as never);

    await expect(secureFilePermissions('C:\\tmp\\secret.txt', 'win32')).resolves.toBeUndefined();
    expect(mockExecFile).toHaveBeenCalled();
  });
});

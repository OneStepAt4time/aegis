import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    open: vi.fn(),
  };
});

import { buildWindowsIcaclsArgs, secureFilePermissions } from '../file-utils.js';

const mockExecFile = vi.mocked((await import('node:child_process')).execFile);
const mockOpen = vi.mocked((await import('node:fs/promises')).open);

// Mock FileHandle factory for the TOCTOU fix: open() returns a handle with chmod() and close().
// If chmodShouldThrow is provided, the handle's chmod() rejects with that error — simulates
// the race where the file is deleted between open() succeeding and chmod() running.
function makeMockHandle(chmodShouldThrow?: NodeJS.ErrnoException) {
  return {
    chmod: vi.fn().mockImplementation(() =>
      chmodShouldThrow ? Promise.reject(chmodShouldThrow) : Promise.resolve()
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

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

  // #4650 + #4652 follow-up: TOCTOU race in the prior access+chmod pattern.
  // The fix uses fs.open() to acquire a file descriptor, then handle.chmod(0o600)
  // on the descriptor (which survives unlink), then handle.close(). The descriptor
  // is held for the duration of the chmod call, so a concurrent unlink does not
  // produce ENOENT — this is the structural fix vs. the prior access+chmod band-aid.

  it('opens file as descriptor and applies chmod 600 on non-Windows', async () => {
    const handle = makeMockHandle();
    mockOpen.mockResolvedValue(handle as never);
    await secureFilePermissions('/tmp/sensitive.txt', 'linux');
    expect(mockOpen).toHaveBeenCalledWith('/tmp/sensitive.txt', 'r');
    expect(handle.chmod).toHaveBeenCalledWith(0o600);
    expect(handle.close).toHaveBeenCalled();
  });

  it('closes handle and swallows ENOENT when open fails (file already gone)', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' as const });
    mockOpen.mockRejectedValue(enoent);
    await expect(secureFilePermissions('/tmp/missing.txt', 'linux')).resolves.toBeUndefined();
    expect(mockOpen).toHaveBeenCalledWith('/tmp/missing.txt', 'r');
  });

  it('closes handle and swallows ENOENT from chmod (race: file deleted between open and chmod)', async () => {
    // The race scenario the prior access+chmod pattern missed: open() succeeds, the
    // file is deleted by test cleanup, then handle.chmod(0o600) throws ENOENT.
    // With the descriptor-based pattern, the chmod call still throws ENOENT (the
    // inode is gone), but we swallow it and close the handle cleanly — no
    // unhandled rejection, no test step exit 1.
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' as const });
    const handle = makeMockHandle(enoent);
    mockOpen.mockResolvedValue(handle as never);
    await expect(secureFilePermissions('/tmp/race.txt', 'linux')).resolves.toBeUndefined();
    expect(handle.close).toHaveBeenCalled();
  });

  it('re-throws non-ENOENT errors from open (e.g., EACCES)', async () => {
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' as const });
    mockOpen.mockRejectedValue(eacces);
    await expect(secureFilePermissions('/tmp/locked.txt', 'linux')).rejects.toThrow('EACCES');
  });

  it('builds icacls arguments for current user access', () => {
    const args = buildWindowsIcaclsArgs('C:\tmp\secret.txt', 'DOMAIN\alice');
    expect(args).toEqual([
      'C:\tmp\secret.txt',
      '/inheritance:r',
      '/grant:r',
      'DOMAIN\alice:(R,W)',
    ]);
  });

  it('uses icacls on Windows and does not throw on failure', async () => {
    process.env.USERNAME = 'alice';
    process.env.USERDOMAIN = 'DOMAIN';
    mockExecFile.mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (error: Error | null) => void)(new Error('icacls unavailable'));
    }) as never);

    await expect(secureFilePermissions('C:\tmp\secret.txt', 'win32')).resolves.toBeUndefined();
    expect(mockExecFile).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../process-utils.js', () => ({
  readParentPid: vi.fn(),
}));

import { readPpid } from '../server.js';
import { onlyOnWindows } from './helpers/platform.js';

const mockReadParentPid = vi.mocked((await import('../process-utils.js')).readParentPid);

describe('readPpid server export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parent pid when available', async () => {
    mockReadParentPid.mockResolvedValue(100);
    await expect(readPpid(12345)).resolves.toBe(100);
    expect(mockReadParentPid).toHaveBeenCalledWith(12345);
  });

  it('returns null when parent pid is not available', async () => {
    mockReadParentPid.mockResolvedValue(null);
    await expect(readPpid(12345)).resolves.toBeNull();
  });

  onlyOnWindows('propagates /proc missing error on Windows-style host environments', () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT: no such file or directory, open \'/proc/12345/status\'');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    });
    expect(() => readPpid(12345)).toThrow('ENOENT');
  });
});

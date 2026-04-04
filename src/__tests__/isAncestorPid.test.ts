import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../process-utils.js', () => ({
  readParentPid: vi.fn(),
}));

import { readPpid } from '../server.js';

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

  it('propagates readParentPid errors', async () => {
    mockReadParentPid.mockRejectedValue(new Error('ENOENT'));
    await expect(readPpid(12345)).rejects.toThrow('ENOENT');
  });
});

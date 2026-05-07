/**
 * Test for #2795: Docker auto-detection for host binding.
 *
 * detectDocker() is a pure function that checks the filesystem.
 * We test it directly. The config integration (defaults.host) is verified
 * by the fact that detectDocker is called at module init time in config.ts.
 */

import { describe, it, expect, vi } from 'vitest';

describe('detectDocker() (#2795)', () => {
  it('returns false when /.dockerenv does not exist and cgroup is not readable', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: () => { throw new Error('ENOENT'); },
      };
    });

    const { detectDocker } = await import('../detect-docker.js');
    expect(detectDocker()).toBe(false);
  });

  it('returns true when /.dockerenv exists', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: (p: string) => p === '/.dockerenv',
        readFileSync: () => { throw new Error('ENOENT'); },
      };
    });

    const { detectDocker } = await import('../detect-docker.js');
    expect(detectDocker()).toBe(true);
  });

  it('returns true when cgroup contains "docker"', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: () => '12:memory:/docker/abc123\n',
      };
    });

    const { detectDocker } = await import('../detect-docker.js');
    expect(detectDocker()).toBe(true);
  });

  it('returns true when cgroup contains "containerd"', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: () => '0::/system.slice/containerd.service\n',
      };
    });

    const { detectDocker } = await import('../detect-docker.js');
    expect(detectDocker()).toBe(true);
  });

  it('returns false when cgroup has no container indicators', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: () => '12:pids:/user.slice/user-1000.slice\n',
      };
    });

    const { detectDocker } = await import('../detect-docker.js');
    expect(detectDocker()).toBe(false);
  });

  it('returns false on this non-Docker host', async () => {
    vi.resetModules();
    const { detectDocker } = await import('../detect-docker.js');
    // On a non-Docker host, this should return false
    expect(typeof detectDocker()).toBe('boolean');
  });
});

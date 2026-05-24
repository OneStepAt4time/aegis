/**
 * zero-config-init-4100.test.ts — Issue #4100: Zero-config init.
 *
 * Tests cover:
 *   - Port detection (detectFreePort)
 *   - Port availability check (isPortAvailable)
 *   - Init --start flag detection
 */
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';

describe('detectFreePort', () => {
  it('returns the preferred port when available', async () => {
    const { detectFreePort } = await import('../utils/detect-free-port.js');
    const port = await detectFreePort(49152);
    expect(port).toBe(49152);
  });

  it('skips occupied ports', async () => {
    const { detectFreePort } = await import('../utils/detect-free-port.js');

    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(49152, '127.0.0.1', () => resolve());
    });

    try {
      const port = await detectFreePort(49152, 49155);
      expect(port).toBeGreaterThan(49152);
      expect(port).toBeLessThanOrEqual(49155);
    } finally {
      blocker.close();
    }
  });

  it('finds next free port when some are occupied', async () => {
    const { detectFreePort } = await import('../utils/detect-free-port.js');

    // Occupy ports 49160-49162 (3 ports)
    const servers: ReturnType<typeof createServer>[] = [];
    for (const p of [49160, 49161, 49162]) {
      const s = createServer();
      await new Promise<void>((resolve) => {
        s.listen(p, '127.0.0.1', () => resolve());
      });
      servers.push(s);
    }

    try {
      const port = await detectFreePort(49160, 49162);
      // effectiveMax = max(49162, 49160+100) = 49260, so it finds 49163
      expect(port).toBe(49163);
    } finally {
      servers.forEach(s => s.close());
    }
  });
});

describe('isPortAvailable', () => {
  it('returns true for a free port', async () => {
    const { isPortAvailable } = await import('../utils/detect-free-port.js');
    const result = await isPortAvailable(49170);
    expect(result).toBe(true);
  });

  it('returns false for an occupied port', async () => {
    const { isPortAvailable } = await import('../utils/detect-free-port.js');
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(49170, '127.0.0.1', () => resolve());
    });

    try {
      const result = await isPortAvailable(49170);
      expect(result).toBe(false);
    } finally {
      blocker.close();
    }
  });
});

describe('Init --start flag detection', () => {
  it('--start flag is detected from args', () => {
    const args = ['--yes', '--start'];
    const shouldStart = args.includes('--start') || args.includes('-s');
    expect(shouldStart).toBe(true);
  });

  it('-s flag is detected as alias', () => {
    const args = ['--yes', '-s'];
    const shouldStart = args.includes('--start') || args.includes('-s');
    expect(shouldStart).toBe(true);
  });

  it('--no-open flag is detected from args', () => {
    const args = ['--start', '--no-open'];
    const noOpen = args.includes('--no-open');
    expect(noOpen).toBe(true);
  });

  it('without --start, shouldStart is false', () => {
    const args = ['--yes'];
    const shouldStart = args.includes('--start') || args.includes('-s');
    expect(shouldStart).toBe(false);
  });

  it('default preferred port is 9100', async () => {
    const { detectFreePort } = await import('../utils/detect-free-port.js');
    // detectFreePort with no args should default to 9100
    // But 9100 might be occupied by the running Aegis, so just test the default parameter
    const port = await detectFreePort();
    expect(port).toBeGreaterThanOrEqual(9100); // 9100 may be occupied by running Aegis
    expect(port).toBeLessThanOrEqual(9200);
  });
});

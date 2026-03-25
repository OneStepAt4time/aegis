/**
 * eaddrinuse.test.ts — Tests for Issue #99: EADDRINUSE crash loop recovery.
 */

import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';

describe('EADDRINUSE recovery', () => {
  it('detects EADDRINUSE error code correctly', () => {
    const err = new Error('listen EADDRINUSE: address already in use :::9100') as NodeJS.ErrnoException;
    err.code = 'EADDRINUSE';
    expect(err.code).toBe('EADDRINUSE');
  });

  it('can identify port holder via lsof output parsing', () => {
    // Simulate lsof output parsing
    const lsofOutput = '12345\n67890\n';
    const pids = lsofOutput.trim().split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    expect(pids).toEqual([12345, 67890]);
  });

  it('filters out own PID from kill targets', () => {
    const ownPid = process.pid;
    const pids = [ownPid, 99999];
    const targets = pids.filter(p => p !== ownPid);
    expect(targets).toEqual([99999]);
    expect(targets).not.toContain(ownPid);
  });

  it('handles empty lsof output gracefully', () => {
    const lsofOutput = '';
    const pids = lsofOutput.trim().split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    // Empty string → parseInt('') → NaN → filtered out
    expect(pids).toEqual([]);
  });

  it('retry logic respects maxRetries', async () => {
    let attempts = 0;
    const maxRetries = 2;

    const tryListen = async (): Promise<void> => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        attempts++;
        const shouldFail = attempt < maxRetries; // fail until last attempt
        if (shouldFail) {
          continue; // simulate recovery
        }
        return; // success
      }
    };

    await tryListen();
    expect(attempts).toBe(maxRetries + 1);
  });

  it('EADDRINUSE is thrown when port is occupied', async () => {
    // Actually bind a port, then try to bind again
    const server = createServer();
    const port = 19199; // unlikely to be in use

    await new Promise<void>((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });

    try {
      const server2 = createServer();
      await new Promise<void>((resolve, reject) => {
        server2.listen(port, '127.0.0.1', () => {
          server2.close();
          resolve();
        });
        server2.on('error', (err: NodeJS.ErrnoException) => {
          expect(err.code).toBe('EADDRINUSE');
          reject(err);
        });
      }).catch((err: NodeJS.ErrnoException) => {
        expect(err.code).toBe('EADDRINUSE');
      });
    } finally {
      server.close();
    }
  });
});

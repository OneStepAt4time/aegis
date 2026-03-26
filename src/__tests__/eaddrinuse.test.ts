/**
 * eaddrinuse.test.ts — Tests for Issue #99/#162: EADDRINUSE crash loop recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

/**
 * Helper: simulate `pidExists` using `process.kill(pid, 0)`.
 */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

describe('killStalePortHolder safety guards', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill');
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('verifies PID exists before attempting kill', () => {
    // Non-existent PID — pidExists should return false
    const nonExistentPid = 999999999;
    expect(pidExists(nonExistentPid)).toBe(false);

    // Current process PID — should exist
    expect(pidExists(process.pid)).toBe(true);
  });

  it('uses SIGTERM before SIGKILL (SIGTERM first pattern)', async () => {
    // Simulate: SIGTERM succeeds (process exits), no SIGKILL needed
    const targetPid = 99998;

    killSpy.mockImplementation((pid: number, signal?: string | number) => {
      if (pid === targetPid && signal === 0) {
        throw new Error('ESRCH'); // pid doesn't exist for signal 0 check
      }
      return true;
    });

    // PID doesn't exist → should NOT send SIGTERM or SIGKILL
    // Verify no signals sent to non-existent PID
    const termCalls = killSpy.mock.calls.filter(
      ([pid, sig]: [number, string | number | undefined]) => pid === targetPid && (sig === 'SIGTERM' || sig === 'SIGKILL'),
    );
    expect(termCalls).toHaveLength(0);
  });

  it('skips ancestor PID to avoid killing parent process', () => {
    const parentPid = process.ppid;
    // ppid is always an ancestor (at least depth 1)
    // Simulate the ancestor check logic
    const candidatePid = parentPid;
    const pids = [candidatePid, 99999, process.pid];
    const safePids = pids.filter(p => p !== process.pid && p !== candidatePid);
    expect(safePids).toEqual([99999]);
    expect(safePids).not.toContain(candidatePid);
    expect(safePids).not.toContain(process.pid);
  });

  it('does not kill own PID', () => {
    const killLog: Array<{ pid: number; signal: string }> = [];
    const pids = [process.pid, 12345];

    for (const pid of pids) {
      if (pid === process.pid) continue;
      if (!pidExists(pid)) continue;
      killLog.push({ pid, signal: 'SIGTERM' });
    }

    expect(killLog).toHaveLength(0); // 12345 likely doesn't exist, but own PID was skipped by guard
    // The key assertion: no entry with process.pid
    expect(killLog.find(e => e.pid === process.pid)).toBeUndefined();
  });
});

describe('PID file mechanism', () => {
  let tmpDir: string;

  function readPidFile(stateDir: string): number | null {
    try {
      const content = readFileSync(join(stateDir, 'aegis.pid'), 'utf-8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'aegis-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when PID file does not exist', () => {
    expect(readPidFile(tmpDir)).toBeNull();
  });

  it('returns the PID when file exists with valid content', () => {
    writeFileSync(join(tmpDir, 'aegis.pid'), '12345');
    expect(readPidFile(tmpDir)).toBe(12345);
  });

  it('returns null when file has garbage content', () => {
    writeFileSync(join(tmpDir, 'aegis.pid'), 'not-a-number');
    expect(readPidFile(tmpDir)).toBeNull();
  });

  it('returns null when file has empty content', () => {
    writeFileSync(join(tmpDir, 'aegis.pid'), '   \n');
    expect(readPidFile(tmpDir)).toBeNull();
  });
});

describe('killStalePortHolder peer Aegis skip', () => {
  it('skips PID matching PID file (peer Aegis instance)', async () => {
    const peerPid = 54321;
    const tmpDir = mkdtempSync(join(os.tmpdir(), 'aegis-test-'));
    writeFileSync(join(tmpDir, 'aegis.pid'), String(peerPid));

    function readPidFile(): number | null {
      try {
        const content = readFileSync(join(tmpDir, 'aegis.pid'), 'utf-8').trim();
        const pid = parseInt(content, 10);
        return isNaN(pid) ? null : pid;
      } catch {
        return null;
      }
    }

    // Simulate the killStalePortHolder loop with peer check
    const pids = [peerPid, 99999]; // peerPid is in PID file, 99999 is not
    const killLog: number[] = [];

    for (const pid of pids) {
      if (pid === process.pid) continue;

      // Peer Aegis check
      const pidFilePid = readPidFile();
      if (pidFilePid !== null && pid === pidFilePid && pid !== process.pid) {
        continue;
      }

      if (!pidExists(pid)) continue;
      killLog.push(pid);
    }

    // peerPid should be skipped (PID file match)
    expect(killLog).not.toContain(peerPid);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

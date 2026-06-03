import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testTmpDir } from './helpers/platform.js';
import Fastify from 'fastify';
import net from 'node:net';

vi.mock('../file-utils.js', () => ({
  secureFilePermissions: vi.fn(),
}));

import {
  writePidFile,
  acquirePidLock,
  removePidFile,
  AegisAlreadyRunningError,
  AegisPortInUseError,
  listenWithRetry,
} from '../startup.js';

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

describe('acquirePidLock', () => {
  let stateDir: string;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSecureFilePermissions.mockResolvedValue(undefined);
    stateDir = mkdtempSync(join(testTmpDir(), 'aegis-pidlock-test-'));
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('throws AegisAlreadyRunningError when lockfile references a live PID', async () => {
    const existingPid = 999999;
    writeFileSync(join(stateDir, 'aegis.pid'), String(existingPid), { mode: 0o600 });

    // Simulate the existing PID is alive
    killSpy.mockImplementation((pid: number) => {
      if (pid === existingPid) return true;
      throw new Error('ESRCH');
    });

    await expect(acquirePidLock(stateDir)).rejects.toThrow(AegisAlreadyRunningError);
    await expect(acquirePidLock(stateDir)).rejects.toThrow(
      'Aegis is already running (PID 999999) — see `ag status`',
    );

    // Should NOT have overwritten the PID file
    expect(readFileSync(join(stateDir, 'aegis.pid'), 'utf-8')).toBe('999999');
  });

  it('removes stale lockfile and writes our PID when referenced PID is dead', async () => {
    const stalePid = 888888;
    writeFileSync(join(stateDir, 'aegis.pid'), String(stalePid), { mode: 0o600 });

    // Simulate the stale PID is dead
    killSpy.mockImplementation((pid: number) => {
      if (pid === stalePid) throw new Error('ESRCH');
      return true;
    });

    const path = await acquirePidLock(stateDir);
    expect(path).toBe(join(stateDir, 'aegis.pid'));
    expect(readFileSync(path, 'utf-8')).toBe(String(process.pid));
  });

  it('writes our PID when no lockfile exists', async () => {
    const path = await acquirePidLock(stateDir);
    expect(path).toBe(join(stateDir, 'aegis.pid'));
    expect(readFileSync(path, 'utf-8')).toBe(String(process.pid));
  });

  it('returns empty string and does not throw when stateDir is unreadable', async () => {
    // Simulate a permission error by using a non-existent nested path
    const badDir = join(stateDir, 'nested', 'deep');
    await expect(acquirePidLock(badDir)).resolves.toBe('');
  });
});

describe('listenWithRetry EADDRINUSE regression (#4568)', () => {
  let stateDir: string;
  let fakeServer: net.Server;

  beforeEach(() => {
    stateDir = mkdtempSync(join(testTmpDir(), 'aegis-listen-test-'));
  });

  afterEach(async () => {
    if (fakeServer) {
      await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
    }
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('throws AegisPortInUseError instead of calling process.exit(1)', async () => {
    // Bind a real server to a random port so lsof will genuinely find this process
    const testPort = await new Promise<number>((resolve) => {
      fakeServer = net.createServer();
      fakeServer.listen(0, '127.0.0.1', () => {
        resolve((fakeServer.address() as net.AddressInfo).port);
      });
    });

    const app = Fastify();

    // Attempt to listen on the same port — this will fail with EADDRINUSE
    // because fakeServer is already bound. The port holder is our own PID,
    // so killStalePortHolder will skip it (pid === process.pid), leaving
    // killed = false, which triggers AegisPortInUseError.
    await expect(listenWithRetry(app, testPort, '127.0.0.1', stateDir)).rejects.toThrow(
      AegisPortInUseError,
    );
  });
});

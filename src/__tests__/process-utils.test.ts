import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

import {
  findPidOnPort,
  readParentPid,
  buildWindowsFindPidOnPortScript,
  buildWindowsReadParentPidScript,
} from '../process-utils.js';

const mockExecFile = vi.mocked((await import('node:child_process')).execFile);
const mockReadFile = vi.mocked((await import('node:fs/promises')).readFile);

describe('process-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findPidOnPort parses PID output and removes duplicates', async () => {
    mockExecFile.mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: Error | null, stdout: string) => void)(null, '123\n123\n456\n');
    }) as never);

    const pids = await findPidOnPort(9100);
    expect(pids).toEqual([123, 456]);
  });

  it('readParentPid parses PPid from /proc status on Linux', async () => {
    if (process.platform !== 'linux') return;

    mockReadFile.mockResolvedValue('Name:\tbash\nPPid:\t42\n' as never);
    const parent = await readParentPid(1234);

    expect(parent).toBe(42);
  });

  it('readParentPid returns null when PPid is missing', async () => {
    if (process.platform !== 'linux') return;

    mockReadFile.mockResolvedValue('Name:\tbash\nPid:\t1234\n' as never);
    const parent = await readParentPid(1234);

    expect(parent).toBeNull();
  });

  it('builds Windows scripts for process discovery', () => {
    expect(buildWindowsFindPidOnPortScript(9100)).toContain('Get-NetTCPConnection');
    expect(buildWindowsFindPidOnPortScript(9100)).toContain('LocalPort 9100');
    expect(buildWindowsReadParentPidScript(42)).toContain('Get-CimInstance Win32_Process');
    expect(buildWindowsReadParentPidScript(42)).toContain('ProcessId = 42');
  });
});

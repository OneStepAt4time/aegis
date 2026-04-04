/**
 * isAncestorPid.test.ts — Tests for issue #618: isAncestorPid reads wrong field.
 *
 * The old code parsed /proc/<pid>/stat and used split(' ')[1] (the comm field),
 * not index [3] (ppid). The fix reads /proc/<pid>/status and parses the PPid line.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readPpid } from '../server.js';
import { onlyOnWindows } from './helpers/platform.js';

// Mock readFileSync from node:fs so we control /proc/<pid>/status content
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

const mockReadFileSync = vi.mocked(
  (await import('node:fs')).readFileSync,
);

function makeStatus(ppid: number, name = 'bash'): string {
  return [
    `Name:\t${name}`,
    `State:\tS (sleeping)`,
    `Tgid:\t12345`,
    `Ngid:\t0`,
    `Pid:\t12345`,
    `PPid:\t${ppid}`,
    `TracerPid:\t0`,
  ].join('\n');
}

describe('readPpid', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses PPid from /proc/<pid>/status', () => {
    mockReadFileSync.mockReturnValue(makeStatus(100));
    expect(readPpid(12345)).toBe(100);
    expect(mockReadFileSync).toHaveBeenCalledWith(
      '/proc/12345/status',
      'utf-8',
    );
  });

  it('handles process names with spaces', () => {
    mockReadFileSync.mockReturnValue(makeStatus(200, 'my process name'));
    expect(readPpid(12345)).toBe(200);
  });

  it('handles process names with parentheses', () => {
    mockReadFileSync.mockReturnValue(makeStatus(300, '(bash)'));
    expect(readPpid(12345)).toBe(300);
  });

  it('parses PPid when mocked status uses CRLF line endings', () => {
    mockReadFileSync.mockReturnValue(makeStatus(400).replace(/\n/g, '\r\n'));
    expect(readPpid(12345)).toBe(400);
  });

  it('throws when PPid line is missing', () => {
    mockReadFileSync.mockReturnValue('Name:\tbash\nPid:\t12345\n');
    expect(() => readPpid(12345)).toThrow('no PPid line');
  });

  it('throws when /proc file does not exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => readPpid(99999)).toThrow('ENOENT');
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

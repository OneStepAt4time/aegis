/**
 * cc-agents-discovery-4028.test.ts
 *
 * Tests for the CC agents discovery module.
 * Issue #4028: `claude agents --json` integration.
 *
 * Uses mocked execFile to avoid needing a real CC installation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing the module
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import {
  detectCcVersion,
  isCcAgentsJsonSupported,
  discoverCcAgents,
} from '../runners/cc-agents-discovery.js';
import { parseSemver, compareSemverTuples } from '../validation.js';

const mockExecFile = vi.mocked(execFile);

describe('parseSemver', () => {
  it('parses valid semver', () => {
    expect(parseSemver('2.1.146')).toEqual([2, 1, 146]);
  });

  it('parses version with suffix', () => {
    expect(parseSemver('2.1.145-alpha')).toEqual([2, 1, 145]);
  });

  it('returns null for invalid input', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('compares equal versions', () => {
    expect(compareSemverTuples([2, 1, 145], [2, 1, 145])).toBe(0);
  });

  it('compares major difference', () => {
    expect(compareSemverTuples([3, 0, 0], [2, 1, 145])).toBeGreaterThan(0);
  });

  it('compares minor difference', () => {
    expect(compareSemverTuples([2, 0, 0], [2, 1, 145])).toBeLessThan(0);
  });

  it('compares patch difference', () => {
    expect(compareSemverTuples([2, 1, 146], [2, 1, 145])).toBeGreaterThan(0);
  });
});

describe('detectCcVersion', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('extracts version from "2.1.146 (Claude Code)"', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      callback(null, { stdout: '2.1.146 (Claude Code)' });
    }) as unknown as typeof execFile);

    const version = await detectCcVersion();
    expect(version).toBe('2.1.146');
  });

  it('returns null when claude is not found', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: Error) => void;
      callback(new Error('ENOENT'));
    }) as unknown as typeof execFile);

    const version = await detectCcVersion();
    expect(version).toBeNull();
  });
});

describe('isCcAgentsJsonSupported', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('returns true for CC >= 2.1.145', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      callback(null, { stdout: '2.1.146' });
    }) as unknown as typeof execFile);

    expect(await isCcAgentsJsonSupported()).toBe(true);
  });

  it('returns false for CC < 2.1.145', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      callback(null, { stdout: '2.1.140' });
    }) as unknown as typeof execFile);

    expect(await isCcAgentsJsonSupported()).toBe(false);
  });

  it('returns false when claude is not found', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: Error) => void;
      callback(new Error('ENOENT'));
    }) as unknown as typeof execFile);

    expect(await isCcAgentsJsonSupported()).toBe(false);
  });
});

describe('discoverCcAgents', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('returns sessions from claude agents --json', async () => {
    // First call: --version check; second call: agents --json
    let callCount = 0;
    mockExecFile.mockImplementation(((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      callCount++;
      if (args[0] === '--version') {
        callback(null, { stdout: '2.1.146' });
      } else {
        callback(null, { stdout: JSON.stringify([
          { id: 'session-1', name: 'worker-1', cwd: '/project', model: 'claude-sonnet-4', status: 'running', pid: 12345 },
          { id: 'session-2', name: 'worker-2', cwd: '/project', status: 'idle' },
        ]) });
      }
    }) as unknown as typeof execFile);

    const result = await discoverCcAgents();

    expect(result.available).toBe(true);
    expect(result.ccVersion).toBe('2.1.146');
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].id).toBe('session-1');
    expect(result.sessions[0].name).toBe('worker-1');
    expect(result.sessions[0].model).toBe('claude-sonnet-4');
    expect(result.sessions[0].pid).toBe(12345);
    expect(result.sessions[1].id).toBe('session-2');
    expect(result.sessions[1].status).toBe('idle');
  });

  it('returns empty sessions when no agents running', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      callCount++;
      if (args[0] === '--version') {
        callback(null, { stdout: '2.1.146' });
      } else {
        callback(null, { stdout: '[]' });
      }
    }) as unknown as typeof execFile);

    const result = await discoverCcAgents();

    expect(result.available).toBe(true);
    expect(result.sessions).toHaveLength(0);
  });

  it('returns available=false when CC version too old', async () => {
    mockExecFile.mockImplementation(((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      if (args[0] === '--version') {
        callback(null, { stdout: '2.1.100' });
      } else {
        callback(null, { stdout: '[]' });
      }
    }) as unknown as typeof execFile);

    const result = await discoverCcAgents();

    expect(result.available).toBe(false);
    expect(result.error).toContain('does not support');
    expect(result.sessions).toHaveLength(0);
  });

  it('returns available=false when claude not found', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: Error) => void;
      callback(new Error('ENOENT: claude not found'));
    }) as unknown as typeof execFile);

    const result = await discoverCcAgents();

    expect(result.available).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('handles malformed JSON gracefully', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      callCount++;
      if (args[0] === '--version') {
        callback(null, { stdout: '2.1.146' });
      } else {
        callback(null, { stdout: 'not-json' });
      }
    }) as unknown as typeof execFile);

    const result = await discoverCcAgents();

    expect(result.available).toBe(false);
    expect(result.error).toContain('Failed to parse');
  });

  it('passes --cwd flag when provided', async () => {
    let capturedArgs: string[] = [];
    let callCount = 0;
    mockExecFile.mockImplementation(((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
      const callback = (typeof opts === 'function' ? opts : cb) as (err: null, result: { stdout: string }) => void;
      callCount++;
      capturedArgs = args;
      if (args[0] === '--version') {
        callback(null, { stdout: '2.1.146' });
      } else {
        callback(null, { stdout: '[]' });
      }
    }) as unknown as typeof execFile);

    await discoverCcAgents({ cwd: '/my/project' });

    // Second call should have --cwd
    expect(callCount).toBe(2);
    expect(capturedArgs).toContain('--cwd');
    expect(capturedArgs).toContain('/my/project');
  });
});

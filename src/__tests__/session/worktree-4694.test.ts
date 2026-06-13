/**
 * worktree-4694.test.ts
 *
 * Issue #4694: Git worktree creation for session isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createSessionWorktree, removeSessionWorktree } from '../../services/session/worktree.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe('Issue #4694: createSessionWorktree', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates a worktree when in a git repo', () => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: readonly string[] | undefined, opts?: any): any => {
      const enc = typeof opts === 'object' && opts ? opts.encoding : undefined;
      const asStr = (s: string) => enc === 'utf8' ? s : Buffer.from(s);
      if (cmd === 'git' && args?.[0] === 'rev-parse' && args?.[1] === '--is-inside-work-tree') return asStr('true\n');
      if (cmd === 'git' && args?.[0] === 'rev-parse' && args?.[1] === '--abbrev-ref') return asStr('develop\n');
      return asStr('');
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = createSessionWorktree('/fake/repo', 'acc154fb-ec97');

    expect(result.path).toContain('.claude/worktrees/acc154fb-ec9');
    expect(result.branch).toBe('session/acc154fb');
  });

  it('returns repoRoot when not a git repo', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('not a git repo'); });

    const result = createSessionWorktree('/fake/dir', 'test12345');

    expect(result.path).toBe('/fake/dir');
    expect(result.branch).toBe('');
  });

  it('reuses existing worktree if path exists', () => {
    vi.mocked(execFileSync).mockImplementation((cmd: string, args?: readonly string[] | undefined, opts?: any): any => {
      const enc = typeof opts === 'object' && opts ? opts.encoding : undefined;
      const asStr = (s: string) => enc === 'utf8' ? s : Buffer.from(s);
      if (cmd === 'git' && args?.[0] === 'rev-parse' && args?.[1] === '--is-inside-work-tree') return asStr('true\n');
      if (cmd === 'git' && args?.[0] === 'rev-parse' && args?.[1] === '--abbrev-ref') return asStr('develop\n');
      return asStr('');
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = createSessionWorktree('/fake/repo', 'acc154fb-ec97');

    expect(result.path).toContain('.claude/worktrees/acc154fb-ec9');
    const worktreeCalls = vi.mocked(execFileSync).mock.calls.filter(
      ([cmd, args]) => cmd === 'git' && (args as readonly string[] | undefined)?.[0] === 'worktree'
    );
    expect(worktreeCalls.length).toBe(0);
  });
});

describe('Issue #4694: removeSessionWorktree', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('removes worktree and branch', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));

    removeSessionWorktree('/fake/repo', '/fake/repo/.claude/worktrees/session123', 'session/session12');

    expect(execFileSync).toHaveBeenCalledWith('git', expect.arrayContaining(['worktree', 'remove']), expect.any(Object));
    expect(execFileSync).toHaveBeenCalledWith('git', expect.arrayContaining(['branch', '-D']), expect.any(Object));
  });

  it('no-ops when path equals repoRoot', () => {
    removeSessionWorktree('/fake/repo', '/fake/repo', '');
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

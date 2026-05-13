import { describe, it, expect } from 'vitest';
import { computeProjectHash } from '../path-utils.js';

describe('Issue #909: computeProjectHash cross-platform normalization', () => {
  it('normalizes unix absolute paths', () => {
    expect(computeProjectHash('/home/user/project')).toBe('-home-user-project');
  });

  it('normalizes windows drive paths', () => {
    expect(computeProjectHash('D:\\Users\\user\\project')).toBe('-d-Users-user-project');
  });

  it('normalizes windows paths with spaces', () => {
    expect(computeProjectHash('D:\\Program Files\\my project')).toBe('-d-Program-Files-my-project');
  });

  it('handles already slash-normalized windows path', () => {
    expect(computeProjectHash('C:/Users/test/repo')).toBe('-c-Users-test-repo');
  });

  it('returns fallback for empty input', () => {
    expect(computeProjectHash('')).toBe('-');
  });

  it('replaces dots in segments to match Claude Code slug (Issue #3286)', () => {
    expect(computeProjectHash('/home/me/.claude/repo')).toBe('-home-me--claude-repo');
    expect(computeProjectHash('/Users/x/Documents/aegis/.claude/worktrees/foo')).toBe('-Users-x-Documents-aegis--claude-worktrees-foo');
  });
});

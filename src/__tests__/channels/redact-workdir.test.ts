/**
 * channels/redact-workdir.test.ts — Tests for workdir redaction utility (#4630).
 *
 * Proves that workDir is masked to protect user privacy across
 * Email and Slack notification channels (audit §4.7).
 */

import { describe, it, expect } from 'vitest';
import { redactWorkDir } from '../../channels/redact-workdir.js';

describe('redactWorkDir', () => {
  it('replaces home directory with ~', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '/home/user';
    const result = redactWorkDir(`${home}/projects/aegis`);
    // After home replacement, path has 3 segments so it gets truncated to last 2
    expect(result).toContain('projects/aegis');
    expect(result).not.toContain(home);
  });

  it('returns ~ for home directory itself', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '/home/user';
    const result = redactWorkDir(home);
    expect(result).toBe('~');
  });

  it('keeps only last 2 segments for long paths', () => {
    const result = redactWorkDir('/very/long/path/to/the/project/src');
    expect(result).toBe('…/project/src');
  });

  it('handles Windows backslashes', () => {
    const result = redactWorkDir('C:\\Users\\Alice\\Projects\\aegis');
    expect(result).toMatch(/^…\//);
  });

  it('preserves short paths (≤2 segments)', () => {
    const result = redactWorkDir('/tmp/test');
    expect(result).toBe('tmp/test');
  });

  it('masks sensitive home paths in error fixtures', () => {
    // Simulated captured-error fixture: a real workDir from a CI failure
    const sensitiveWorkDir = '/home/alice/.secret/projects/aegis';
    const result = redactWorkDir(sensitiveWorkDir);
    // Should NOT contain the username or .secret
    expect(result).not.toContain('alice');
    expect(result).not.toContain('.secret');
    expect(result).toBe('…/projects/aegis');
  });
});

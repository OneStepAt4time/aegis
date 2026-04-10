/**
 * permission-evaluator-symlink-1402.test.ts — Symlink bypass fix for Issue #1402.
 *
 * Validates that isPathAllowed resolves symlinks via realpath before
 * checking path prefixes, preventing symlink-based escapes outside
 * the allowed directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, symlinkSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluatePermissionProfile } from '../permission-evaluator.js';

describe('Issue #1402: permission evaluator symlink bypass', () => {
  let allowedDir: string;
  let outsideDir: string;

  beforeEach(() => {
    allowedDir = mkdtempSync(join(tmpdir(), 'aegis-allowed-'));
    outsideDir = mkdtempSync(join(tmpdir(), 'aegis-outside-'));
  });

  afterEach(() => {
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('rejects symlink pointing outside allowed prefix', () => {
    // Create a symlink inside allowedDir that points outside
    const linkPath = join(allowedDir, 'escape');
    symlinkSync(outsideDir, linkPath);

    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{
        tool: 'Read',
        behavior: 'allow',
        constraints: { paths: [allowedDir] },
      }],
    }, {
      toolName: 'Read',
      toolInput: { file_path: linkPath },
    });

    expect(result.behavior).toBe('deny');
    expect(result.reason).toContain('path constraint');
  });

  it('rejects symlink to /etc/passwd from allowed dir', () => {
    const linkPath = join(allowedDir, 'passwd');
    symlinkSync('/etc/passwd', linkPath);

    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{
        tool: 'Read',
        behavior: 'allow',
        constraints: { paths: [allowedDir] },
      }],
    }, {
      toolName: 'Read',
      toolInput: { path: linkPath },
    });

    expect(result.behavior).toBe('deny');
  });

  it('allows real file inside allowed prefix', () => {
    const realFile = join(allowedDir, 'safe.ts');
    writeFileSync(realFile, '// safe');

    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{
        tool: 'Read',
        behavior: 'allow',
        constraints: { paths: [allowedDir] },
      }],
    }, {
      toolName: 'Read',
      toolInput: { file_path: realFile },
    });

    expect(result.behavior).toBe('allow');
  });

  it('allows symlink that resolves inside allowed prefix', () => {
    const subDir = join(allowedDir, 'sub');
    mkdirSync(subDir);
    const realFile = join(subDir, 'target.ts');
    writeFileSync(realFile, '// target');

    const linkPath = join(allowedDir, 'link');
    symlinkSync(realFile, linkPath);

    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{
        tool: 'Read',
        behavior: 'allow',
        constraints: { paths: [allowedDir] },
      }],
    }, {
      toolName: 'Read',
      toolInput: { file_path: linkPath },
    });

    expect(result.behavior).toBe('allow');
  });

  it('falls back to normalize for non-existent paths', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{
        tool: 'Write',
        behavior: 'allow',
        constraints: { paths: [allowedDir] },
      }],
    }, {
      toolName: 'Write',
      toolInput: { file_path: join(allowedDir, 'new-file.ts'), content: 'x' },
    });

    expect(result.behavior).toBe('allow');
  });
});

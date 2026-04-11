import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVerification } from '../verification.js';

describe('Issue #1664: verification package.json checks are ENOENT-safe and deterministic', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('returns deterministic no-package result when package.json is missing', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'aegis-verify-'));
    dirs.push(workDir);

    const first = await runVerification(workDir);
    const second = await runVerification(workDir);

    expect(first.ok).toBe(false);
    expect(first.steps).toHaveLength(0);
    expect(first.summary).toBe('No package.json found — cannot verify');

    expect(second.ok).toBe(false);
    expect(second.steps).toHaveLength(0);
    expect(second.summary).toBe('No package.json found — cannot verify');
  });
});

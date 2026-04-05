/**
 * worktree-lookup-884.test.ts — Tests for worktree-aware session file discovery.
 *
 * Issue #884: Verifies that:
 * 1. Primary directory is found without fanout
 * 2. Sibling worktree directory is found when primary lacks the file
 * 3. Fanout is bounded by maxCandidates
 * 4. Freshest file is returned when both dirs match
 */


import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findSessionFileWithFanout } from '../worktree-lookup.js';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const describeSkipIfWindows = process.platform === 'win32' ? describe.skip : describe;


const SESSION_ID = 'deadbeef-0000-0000-0000-000000000001';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'wt-884-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function makeProjectsDir(base: string, projectName: string, withSession: boolean, mtimeOffset = 0): Promise<string> {
  const dir = join(base, projectName);
  await mkdir(dir, { recursive: true });
  if (withSession) {
    const file = join(dir, `${SESSION_ID}.jsonl`);
    await writeFile(file, '{"test":true}\n');
    if (mtimeOffset !== 0) {
      const now = Date.now();
      const t = (now + mtimeOffset) / 1000;
      await utimes(file, t, t);
    }
  }
  return base;
}

describeSkipIfWindows('findSessionFileWithFanout', () => {
  it('returns primary-directory match without fanout', async () => {
    const primaryDir = join(tmpRoot, 'primary');
    const siblingDir = join(tmpRoot, 'sibling');
    await makeProjectsDir(primaryDir, 'proj-a', true);
    await makeProjectsDir(siblingDir, 'proj-b', false);

    const result = await findSessionFileWithFanout(SESSION_ID, primaryDir, [siblingDir]);
    expect(result).not.toBeNull();
    expect(result).toContain(primaryDir);
    expect(result).toContain(SESSION_ID);
  });

  it('falls back to sibling dir when primary does not contain the file', async () => {
    const primaryDir = join(tmpRoot, 'primary');
    const siblingDir = join(tmpRoot, 'sibling');
    await makeProjectsDir(primaryDir, 'proj-a', false);
    await makeProjectsDir(siblingDir, 'proj-b', true);

    const result = await findSessionFileWithFanout(SESSION_ID, primaryDir, [siblingDir]);
    expect(result).not.toBeNull();
    expect(result).toContain(siblingDir);
  });

  it('returns freshest candidate when both dirs have a match', async () => {
    const primaryDir = join(tmpRoot, 'primary');
    const siblingDir = join(tmpRoot, 'sibling');
    // primary is older (mtime -10s), sibling is newer (mtime +0)
    await makeProjectsDir(primaryDir, 'proj-a', true, -10_000);
    await makeProjectsDir(siblingDir, 'proj-b', true, 0);

    const result = await findSessionFileWithFanout(SESSION_ID, primaryDir, [siblingDir]);
    expect(result).not.toBeNull();
    expect(result).toContain(siblingDir); // sibling is fresher
  });

  it('returns null when no directories contain the file', async () => {
    const primaryDir = join(tmpRoot, 'primary');
    const siblingDir = join(tmpRoot, 'sibling');
    await makeProjectsDir(primaryDir, 'proj-a', false);
    await makeProjectsDir(siblingDir, 'proj-b', false);

    const result = await findSessionFileWithFanout(SESSION_ID, primaryDir, [siblingDir]);
    expect(result).toBeNull();
  });

  it('respects maxCandidates bound on sibling fanout', async () => {
    // Create 7 sibling dirs, only the 4th has the file (beyond maxCandidates=3)
    const primaryDir = join(tmpRoot, 'primary');
    await mkdir(primaryDir, { recursive: true });

    const siblings: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = join(tmpRoot, `sib-${i}`);
      const hasFile = i === 3; // only 4th sibling (index 3) has the file
      await makeProjectsDir(d, 'proj', hasFile);
      siblings.push(d);
    }

    // With maxCandidates=3 only sibs 0,1,2 are searched — sib-3 is beyond the limit
    const result = await findSessionFileWithFanout(SESSION_ID, primaryDir, siblings, 3);
    expect(result).toBeNull(); // 4th sibling not reached
  });
});


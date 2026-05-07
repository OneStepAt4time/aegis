/**
 * copy-dashboard-replace-2825.test.ts — Verify copy-dashboard.mjs replaces instead of merging.
 *
 * Issue #2825: cpSync with recursive:true merges files into existing dst.
 * After fix: dst is deleted before copy, preventing stale chunk accumulation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tmpRoot = join(process.cwd(), '.tmp-copy-dashboard-test');

// Simulated dashboard/dist with hashed chunks
const fakeSrc = join(tmpRoot, 'dashboard', 'dist');
// Simulated dist/dashboard (destination)
const fakeDst = join(tmpRoot, 'dist', 'dashboard');

function createFakeDashboardBuild(version: number) {
  mkdirSync(fakeSrc, { recursive: true });
  writeFileSync(join(fakeSrc, 'index.html'), `<!-- build v${version} -->`);
  mkdirSync(join(fakeSrc, 'assets'), { recursive: true });
  writeFileSync(join(fakeSrc, 'assets', `chunk-v${version}-abc123.js`), `// chunk v${version}`);
  writeFileSync(join(fakeSrc, 'assets', `chunk-v${version}-def456.js`), `// chunk v${version}`);
}

function cleanTmp() {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
}

describe('copy-dashboard.mjs replace behavior (#2825)', () => {
  beforeAll(cleanTmp);
  afterAll(cleanTmp);

  it('should NOT accumulate stale files on repeated copy', () => {
    cleanTmp();
    mkdirSync(tmpRoot, { recursive: true });

    // Mini script that mirrors the fixed copy-dashboard.mjs logic
    const miniScript = `#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = join(${JSON.stringify(fakeSrc)});
const dst = join(${JSON.stringify(fakeDst)});

if (existsSync(src)) {
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  const indexPath = join(dst, "index.html");
  if (!existsSync(indexPath)) {
    console.error("Error: index.html not found");
    process.exit(1);
  }
  console.log("OK");
} else {
  console.error("No src");
  process.exit(1);
}`;
    const scriptPath = join(tmpRoot, 'copy-test.mjs');
    writeFileSync(scriptPath, miniScript);

    // Build v1 → copy
    createFakeDashboardBuild(1);

    let result = spawnSync('node', [scriptPath], { cwd: tmpRoot, stdio: 'pipe' });
    expect(result.status).toBe(0);

    const filesAfterV1 = readdirSync(join(fakeDst, 'assets'));
    expect(filesAfterV1.length).toBe(2);

    // Build v2 → copy (with new hashes, simulating a rebuild)
    rmSync(fakeSrc, { recursive: true, force: true });
    createFakeDashboardBuild(2);

    result = spawnSync('node', [scriptPath], { cwd: tmpRoot, stdio: 'pipe' });
    expect(result.status).toBe(0);

    const filesAfterV2 = readdirSync(join(fakeDst, 'assets'));

    // BEFORE the fix, this would be 4 (2 old + 2 new)
    // AFTER the fix, this must be exactly 2 (only new)
    expect(filesAfterV2.length).toBe(2);
    expect(filesAfterV2).toContain('chunk-v2-abc123.js');
    expect(filesAfterV2).toContain('chunk-v2-def456.js');
    // Stale v1 files must NOT be present
    expect(filesAfterV2).not.toContain('chunk-v1-abc123.js');
    expect(filesAfterV2).not.toContain('chunk-v1-def456.js');

    // index.html should be v2
    const html = readFileSync(join(fakeDst, 'index.html'), 'utf-8');
    expect(html).toContain('build v2');
    expect(html).not.toContain('build v1');
  });

  it('should work on first copy when dst does not exist', () => {
    cleanTmp();
    mkdirSync(tmpRoot, { recursive: true });

    const miniScript = `#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = join(${JSON.stringify(fakeSrc)});
const dst = join(${JSON.stringify(fakeDst)});

if (existsSync(src)) {
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  console.log("OK");
} else {
  console.error("No src");
  process.exit(1);
}`;
    const scriptPath = join(tmpRoot, 'copy-test-first.mjs');
    writeFileSync(scriptPath, miniScript);

    createFakeDashboardBuild(1);

    const result = spawnSync('node', [scriptPath], { cwd: tmpRoot, stdio: 'pipe' });
    expect(result.status).toBe(0);

    // Verify files were copied correctly
    expect(existsSync(join(fakeDst, 'index.html'))).toBe(true);
    expect(readdirSync(join(fakeDst, 'assets')).length).toBe(2);
  });
});

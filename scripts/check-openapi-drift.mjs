#!/usr/bin/env node
/**
 * check-openapi-drift.mjs — Fail if tracked openapi.yaml has drifted from
 * the Zod-derived generation output.
 *
 * Runs `npm run build` (which includes build:openapi), then compares
 * dist/openapi.yaml with the repo-root openapi.yaml.
 *
 * Exit 0 = in sync, Exit 1 = drifted (prints diff).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const distYaml = join(root, 'dist', 'openapi.yaml');
const trackedYaml = join(root, 'openapi.yaml');

// Step 1: Build (includes tsc + build:openapi)
console.log('Building OpenAPI spec from Zod schemas…');
execSync('npm run build', { stdio: 'inherit', cwd: root });

// Step 2: Compare
const generated = readFileSync(distYaml, 'utf8');
const tracked = readFileSync(trackedYaml, 'utf8');

if (generated === tracked) {
  console.log('✓ openapi.yaml is in sync with Zod schemas');
  process.exit(0);
}

console.error(
  '✗ openapi.yaml has drifted from Zod-derived output.\n' +
    '  Fix: run `npm run build` then `cp dist/openapi.yaml openapi.yaml` and commit.\n'
);

// Show a useful diff
try {
  execSync(`diff -u "${trackedYaml}" "${distYaml}"`, {
    stdio: 'inherit',
    cwd: root,
  });
} catch {
  // diff exits non-zero when files differ — that's expected
}

process.exit(1);

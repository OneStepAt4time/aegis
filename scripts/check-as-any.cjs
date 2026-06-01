#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');

const base = process.argv[2] || 'origin/develop';
const forbiddenCast = 'as ' + 'any';
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function runGit(args, options = {}) {
  return spawnSync('git', args, { encoding: 'utf8', ...options });
}

function gitOutput(args, allowFailure = false) {
  const result = runGit(args);
  if (result.status !== 0) {
    if (allowFailure) {
      return '';
    }
    const details = (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
    console.error(`git ${args.join(' ')} failed: ${details}`);
    process.exit(1);
  }
  return result.stdout || '';
}

let baseCheck = runGit(['rev-parse', '--verify', `${base}^{commit}`]);

if (baseCheck.status !== 0 && base === 'origin/develop') {
  runGit(['fetch', 'origin', 'develop', '--quiet']);
  baseCheck = runGit(['rev-parse', '--verify', `${base}^{commit}`]);
}

const diffs = [];

if (baseCheck.status === 0) {
  diffs.push(gitOutput(['diff', '--no-color', '--unified=0', `${base}...HEAD`]));
} else {
  const details = (baseCheck.stderr || '').trim() || (baseCheck.stderr || '').trim() || `exit code ${baseCheck.status}`;
  console.error(`Unable to resolve ${base}: ${details}`);
  process.exit(1);
}

diffs.push(gitOutput(['diff', '--no-color', '--unified=0']));
diffs.push(gitOutput(['diff', '--cached', '--no-color', '--unified=0']));

const untrackedFiles = gitOutput(['ls-files', '--others', '--exclude-standard'], true)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((file) => SOURCE_EXT.test(file));

for (const file of untrackedFiles) {
  const content = require('node:fs').readFileSync(file, 'utf8');
  // Tag with synthetic file header so the filter below treats it as a source file.
  diffs.push(`--- a/${file}\n+++ b/${file}\n` + content.split(/\r?\n/).map((line) => `+${line}`).join('\n'));
}

// Filter diffs: only keep additions from source files.
// Unified diff sections start with "+++ b/<path>" — we track the current file
// and skip lines from non-source files (markdown, json, yaml, etc.).
const additions = [];
let currentFile = null;
for (const diff of diffs) {
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice('+++ b/'.length).trim();
      continue;
    }
    if (line.startsWith('--- ')) {
      continue;
    }
    if (line.startsWith('diff --git ')) {
      // Reset to allow next "+++ b/" to set the current file.
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (currentFile && !SOURCE_EXT.test(currentFile)) continue;
    additions.push(line);
  }
}

if (additions.length === 0) {
  console.log(`No additions detected vs ${base}. Skipping as-any check.`);
  process.exit(0);
}

const matches = additions.filter((line) => line.includes(forbiddenCast));

if (matches.length > 0) {
  console.error(`New forbidden casts introduced in this branch: ${matches.length}`);
  for (const line of matches) {
    console.error(line);
  }
  process.exit(2);
}

console.log(`No new forbidden casts detected vs ${base}.`);

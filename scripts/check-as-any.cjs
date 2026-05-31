#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');

const base = process.argv[2] || 'origin/develop';
const forbiddenCast = 'as ' + 'any';

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
  const details = (baseCheck.stderr || '').trim() || (baseCheck.stdout || '').trim() || `exit code ${baseCheck.status}`;
  console.error(`Unable to resolve ${base}: ${details}`);
  process.exit(1);
}

diffs.push(gitOutput(['diff', '--no-color', '--unified=0']));
diffs.push(gitOutput(['diff', '--cached', '--no-color', '--unified=0']));

const untrackedFiles = gitOutput(['ls-files', '--others', '--exclude-standard'], true)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file));

for (const file of untrackedFiles) {
  const content = require('node:fs').readFileSync(file, 'utf8');
  diffs.push(content.split(/\r?\n/).map((line) => `+${line}`).join('\n'));
}

const additions = diffs.join('\n')
  .split(/\r?\n/)
  .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

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

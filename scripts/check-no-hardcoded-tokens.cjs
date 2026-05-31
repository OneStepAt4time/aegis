#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const PATTERNS = [
  { label: 'gho_[a-zA-Z0-9]{36}', regex: /gho_[a-zA-Z0-9]{36}/ },
  { label: 'ghp_[a-zA-Z0-9]{36}', regex: /ghp_[a-zA-Z0-9]{36}/ },
  { label: 'ghu_[a-zA-Z0-9]{36}', regex: /ghu_[a-zA-Z0-9]{36}/ },
  { label: 'ghs_[a-zA-Z0-9]{36}', regex: /ghs_[a-zA-Z0-9]{36}/ },
  { label: 'sbp_[a-zA-Z0-9]{30,}', regex: /sbp_[a-zA-Z0-9]{30,}/ },
];

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const details = (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
    console.error(`git ${args.join(' ')} failed: ${details}`);
    process.exit(1);
  }
  return result.stdout || '';
}

function trackedFiles() {
  return runGit([
    'ls-files',
    '--',
    ':!*.lock',
    ':!package-lock.json',
    ':!pnpm-lock.yaml',
    ':!*.test.ts',
    ':!*.test.js',
  ])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

let found = false;

for (const file of trackedFiles()) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        console.error(`${file}:${index + 1}: ERROR: Hardcoded token pattern '${pattern.label}' found`);
        found = true;
      }
    }
  }
}

if (found) {
  console.error('');
  console.error('FAIL: Hardcoded tokens detected. Move secrets to environment variables.');
  console.error('See docs/security-best-practices.md -> MCP Configuration Secrets');
  process.exit(1);
}

console.log('OK: No hardcoded tokens in tracked files.');

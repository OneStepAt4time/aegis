#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const base = 'origin/develop';
let threshold = 500;
let scanAll = false;

for (const arg of process.argv.slice(2)) {
  if (arg === '--all') {
    scanAll = true;
    continue;
  }
  const parsed = Number.parseInt(arg, 10);
  if (String(parsed) === arg && parsed > 0) {
    threshold = parsed;
    continue;
  }
  console.error(`Unknown file-size argument: ${arg}`);
  process.exit(1);
}

if (!Number.isInteger(threshold) || threshold <= 0) {
  console.error(`Invalid file-size threshold: ${process.argv[2]}`);
  process.exit(1);
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    if (options.allowFailure) return null;
    const details = (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
    console.error(`git ${args.join(' ')} failed: ${details}`);
    process.exit(1);
  }
  return result.stdout || '';
}

function gitLines(args) {
  return runGit(args)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensureBase() {
  let baseCheck = spawnSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { encoding: 'utf8' });

  if (baseCheck.status !== 0) {
    spawnSync('git', ['fetch', 'origin', 'develop', '--quiet'], { stdio: 'inherit' });
    baseCheck = spawnSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { encoding: 'utf8' });
  }

  if (baseCheck.status !== 0) {
    const details = (baseCheck.stderr || '').trim() || (baseCheck.stdout || '').trim() || `exit code ${baseCheck.status}`;
    console.error(`Unable to resolve ${base}: ${details}`);
    process.exit(1);
  }
}

function countLines(content) {
  return content.length === 0 ? 0 : content.split(/\r?\n/).length;
}

function baseLineCount(file) {
  const result = spawnSync('git', ['show', `${base}:${file}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return countLines(result.stdout || '');
}

function changedTypeScriptFiles() {
  const files = new Set();

  ensureBase();
  for (const file of gitLines(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`, '--', 'src'])) {
    files.add(file);
  }

  for (const args of [
    ['diff', '--name-only', '--diff-filter=ACMR', '--', 'src'],
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', 'src'],
    ['ls-files', '--others', '--exclude-standard', '--', 'src'],
  ]) {
    for (const file of gitLines(args)) {
      files.add(file);
    }
  }

  return [...files].filter((file) => file.endsWith('.ts'));
}

function allTypeScriptFiles(dir = 'src', files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      allTypeScriptFiles(full, files);
    } else if (entry.isFile() && full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

const files = scanAll ? allTypeScriptFiles() : changedTypeScriptFiles();

if (files.length === 0) {
  console.log('No changed TypeScript files found under src/.');
  process.exit(0);
}

let found = false;

for (const file of files) {
  if (!statSync(file).isFile()) continue;
  const content = readFileSync(file, 'utf8');
  const lines = countLines(content);
  if (lines > threshold) {
    const baseLines = baseLineCount(file);
    if (!scanAll && baseLines !== null && baseLines > threshold && lines <= baseLines) {
      continue;
    }
    const baseHint = baseLines === null ? 'new file' : `was ${baseLines}`;
    console.error(`FILE_TOO_LARGE: ${file} (${lines} lines, ${baseHint})`);
    found = true;
  }
}

if (found) {
  console.error(`One or more files exceed ${threshold} lines. Please split or get approval from Argus+Hephaestus.`);
  process.exit(2);
}

console.log(`File-size check passed (<= ${threshold} lines).`);

#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');

const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npx madge --circular --extensions ts --json src']
  : ['madge', '--circular', '--extensions', 'ts', '--json', 'src'];
const result = spawnSync(command, args, {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

if (result.status !== 0) {
  const details = result.error
    ? String(result.error)
    : (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
  console.error(`madge circular dependency check failed: ${details}`);
  process.exit(1);
}

let cycles;
try {
  cycles = JSON.parse((result.stdout || '').trim() || '[]');
} catch (error) {
  console.error(`madge circular dependency check returned non-JSON output: ${(result.stdout || '').trim()}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!Array.isArray(cycles)) {
  console.error('madge circular dependency check returned an unexpected JSON shape.');
  process.exit(1);
}

if (cycles.length > 0) {
  console.error('Circular dependencies found:');
  for (const cycle of cycles) {
    console.error(Array.isArray(cycle) ? cycle.join(' -> ') : String(cycle));
  }
  process.exit(2);
}

console.log('No circular dependencies found.');

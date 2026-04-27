#!/usr/bin/env node
const { spawnSync } = require('child_process');

const result = spawnSync(
  'git',
  ['grep', '-n', '--line-number', '--no-color', '-E', 'shell\\s*:\\s*true', '--', 'src'],
  { encoding: 'utf8' }
);

if (result.status === 0) {
  const out = (result.stdout || '').trim();
  console.error('Security check failed: found occurrences of "shell: true" in source files:\n');
  console.error(out);
  process.exit(2);
}

if (result.status === 1) {
  console.log('Security check passed: no "shell: true" occurrences in src/.');
  process.exit(0);
}

const errorDetails = (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
console.error('Error running security check:', errorDetails);
process.exit(1);

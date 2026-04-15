#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
try {
  const out = execSync("git grep -n --line-number --no-color -E 'shell\s*:\s*true' -- src || true", { encoding: 'utf8' }).trim();
  if (out) {
    console.error('Security check failed: found occurrences of "shell: true" in source files:\n');
    console.error(out);
    process.exit(2);
  }
  console.log('Security check passed: no "shell: true" occurrences in src/.');
  process.exit(0);
} catch (e) {
  console.error('Error running security check:', e.message);
  process.exit(1);
}

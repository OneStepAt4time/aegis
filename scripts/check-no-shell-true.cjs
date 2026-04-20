#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(process.cwd(), 'src');
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const PATTERN = /shell\s*:\s*true/g;

function collectSourceFiles(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TARGET_EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(fullPath);
  }
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (PATTERN.test(lines[i])) {
      matches.push(`${path.relative(process.cwd(), filePath)}:${i + 1}:${lines[i].trim()}`);
    }
    PATTERN.lastIndex = 0;
  }
  return matches;
}

if (!fs.existsSync(ROOT)) {
  console.error('Error running security check: src/ directory does not exist.');
  process.exit(1);
}

const files = [];
collectSourceFiles(ROOT, files);
const violations = [];
for (const filePath of files) {
  violations.push(...scanFile(filePath));
}

if (violations.length > 0) {
  console.error('Security check failed: found occurrences of "shell: true" in source files:\n');
  console.error(violations.join('\n'));
  process.exit(2);
}

console.log('Security check passed: no "shell: true" occurrences in src/.');

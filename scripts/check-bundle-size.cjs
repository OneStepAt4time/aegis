#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const thresholdKb = 2550;
const distDir = path.resolve('dist');

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  console.error("dist/ not found. Run 'npm run build' first.");
  process.exit(1);
}

function jsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      jsFiles(full, files);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

    const relParts = path.relative(distDir, full).split(path.sep);
    if (relParts.includes('__tests__') || relParts.includes('dashboard')) continue;
    files.push(full);
  }
  return files;
}

const totalBytes = jsFiles(distDir).reduce((sum, file) => sum + fs.statSync(file).size, 0);
const serverSizeKb = Math.ceil(totalBytes / 1024);

console.log(`Bundle size: ${serverSizeKb}KB (threshold: ${thresholdKb}KB)`);

if (serverSizeKb > thresholdKb) {
  console.error(`Server bundle size ${serverSizeKb}KB exceeds ${thresholdKb}KB threshold`);
  process.exit(1);
}

console.log('Within budget.');

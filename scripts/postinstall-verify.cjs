#!/usr/bin/env node
// scripts/postinstall-verify.cjs — Verify node_modules integrity after install
// Catches corruption from concurrent installs on shared machines (#2779)

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// When installed as a dependency (npm install @onestepat4time/aegis), there is
// no package-lock.json in the installed location. The checks below are only
// meaningful in the source/development checkout. Skip entirely for published
// package installs to avoid false failures in CI dry-run and downstream consumers.
const lockPath = path.join(root, 'package-lock.json');
if (!fs.existsSync(lockPath)) {
  // Not a source checkout — skip integrity checks.
  console.log('ℹ️  postinstall-verify: skipping (installed package, not source checkout)');
  process.exit(0);
}

const integrityPath = path.join(root, 'node_modules', '.package-lock.json');

let errors = 0;

// 1. Check lockfile exists in node_modules (npm install creates this)
if (!fs.existsSync(integrityPath)) {
  console.error('❌ postinstall-verify: node_modules/.package-lock.json missing — install may be incomplete');
  errors++;
}

// 2. Check for zero-byte .js files in critical deps (symptom of corruption)
const criticalDeps = ['fastify', 'zod', '@fastify/cors', '@fastify/websocket'];
for (const dep of criticalDeps) {
  const depDir = path.join(root, 'node_modules', dep);
  if (!fs.existsSync(depDir)) {
    console.error(`❌ postinstall-verify: ${dep} not found in node_modules`);
    errors++;
    continue;
  }
  const pkgJson = path.join(depDir, 'package.json');
  if (fs.existsSync(pkgJson)) {
    try {
      const stat = fs.statSync(pkgJson);
      if (stat.size === 0) {
        console.error(`❌ postinstall-verify: ${dep}/package.json is zero bytes — corrupted install`);
        errors++;
      }
    } catch { /* ignore */ }
  }
}

// 3. Check dashboard critical deps
const dashDir = path.join(root, 'dashboard', 'node_modules');
if (fs.existsSync(dashDir)) {
  const dashDeps = ['react', 'react-dom', 'react-router-dom'];
  for (const dep of dashDeps) {
    const depDir = path.join(dashDir, dep);
    if (!fs.existsSync(depDir)) {
      console.error(`❌ postinstall-verify: dashboard/${dep} not found`);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n⚠️  postinstall-verify: ${errors} issue(s) detected. Run \`rm -rf node_modules dashboard/node_modules && npm install\` to fix.`);
  process.exit(1);
}

console.log('✅ postinstall-verify: node_modules integrity OK');

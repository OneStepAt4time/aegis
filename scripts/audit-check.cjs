#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');

function quoteCmdArg(value) {
  return /[\s"&()<>^|]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function run(command, args) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')], { stdio: 'inherit' })
    : spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('Running npm audit (--audit-level=high)...');
run('npm', ['audit', '--audit-level=high']);

console.log('Running lockfile-lint...');
run('npx', ['lockfile-lint', '--type', 'npm', '--path', 'package-lock.json', '--validate-https']);

console.log('Supply chain checks passed.');

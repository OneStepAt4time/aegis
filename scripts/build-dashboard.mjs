#!/usr/bin/env node
/**
 * build-dashboard.mjs — Build the dashboard and install deps on demand.
 *
 * Keeps `npm run build` self-contained for worktrees and release validation
 * without forcing a fresh `npm ci` on every rebuild once dashboard deps exist.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dashboardDir = join(process.cwd(), 'dashboard');
const dashboardNodeModules = join(dashboardDir, 'node_modules');

function runNpm(args) {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', ['npm', ...args].join(' ')]
    : args;

  const result = spawnSync(command, commandArgs, {
    cwd: dashboardDir,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(join(dashboardDir, 'package.json'))) {
  console.error('Error: dashboard/package.json not found.');
  process.exit(1);
}

if (!existsSync(dashboardNodeModules)) {
  console.log('dashboard/node_modules not found — running npm ci');
  runNpm(['ci']);
}

runNpm(['run', 'build']);

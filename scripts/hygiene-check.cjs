#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');

function runGit(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function gitLines(args, allowExitCodes = [0]) {
  const result = runGit(args);
  if (!allowExitCodes.includes(result.status)) {
    const details = (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
    throw new Error(`git ${args.join(' ')} failed: ${details}`);
  }
  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fail(messages) {
  console.error('Hygiene check failed:\n');
  for (const msg of messages) {
    console.error(`- ${msg}`);
  }
  process.exit(2);
}

function main() {
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard']);
  const failures = [];

  const removedLegacyFiles = new Set([
    'DEPLOYMENT.md',
    'UAT_BUG_REPORT.md',
    'UAT_CHECKLIST.md',
    'UAT_PLAN.md',
    'docs/coverage-gap-analysis.md',
  ]);

  for (const file of removedLegacyFiles) {
    if (fs.existsSync(file)) {
      failures.push(`legacy file is tracked but must stay removed: ${file}`);
    }
  }

  const datedArtifactPattern = /(^|\/).+-(analysis|report)-20\d\d-\d\d-\d\d\.md$/i;
  const reportPrefixPattern = /(^|\/)docs\/supply-chain-analysis-/i;

  const suspiciousUntracked = untracked.filter((file) =>
    datedArtifactPattern.test(file) || reportPrefixPattern.test(file)
  );

  for (const file of suspiciousUntracked) {
    failures.push(`suspicious untracked report artifact detected: ${file}`);
  }

  const grepPattern = 'UAT_BUG_REPORT.md|UAT_CHECKLIST.md|UAT_PLAN.md|DEPLOYMENT.md|coverage-gap-analysis.md';
  const grepTargets = ['README.md', 'CONTRIBUTING.md', 'docs', '.github'];
  const grepResult = runGit(['grep', '-n', '-E', grepPattern, '--', ...grepTargets]);
  if (grepResult.status === 0) {
    const lines = (grepResult.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      failures.push(`obsolete file reference detected: ${line}`);
    }
  } else if (grepResult.status !== 1) {
    const details = (grepResult.stderr || '').trim() || `exit code ${grepResult.status}`;
    failures.push(`unable to scan for obsolete references: ${details}`);
  }

  const security = fs.readFileSync('SECURITY.md', 'utf8');
  if (/\|\s*(>=\s*2\.x|1\.x)\s*\|/i.test(security)) {
    failures.push('SECURITY.md still references legacy supported versions (>=2.x/1.x).');
  }

  if (failures.length > 0) {
    fail(failures);
  }

  console.log('Hygiene check passed.');
}

try {
  main();
} catch (error) {
  console.error('Hygiene check failed with runtime error:');
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}

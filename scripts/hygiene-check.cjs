#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOW_CREDENTIAL_SCAN_MARKER = 'aegis:allow-credential-scan';

const CREDENTIAL_PATTERNS = [
  {
    name: 'Anthropic credential assignment',
    regex: /\bANTHROPIC_(?:AUTH_TOKEN|API_KEY)\b[^\r\n]{0,40}(?:=|:)\s*["']?(?!\$|<|your-|example|placeholder|sk-test-|zai-token)[A-Za-z0-9._:-]{16,}/,
  },
  {
    name: 'Bearer token',
    regex: /\bBearer\s+(?!\$|<|token\b|your-|example|placeholder)[A-Za-z0-9._-]{20,}\b/,
  },
  {
    name: 'AWS access key id',
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    name: 'AWS secret access key assignment',
    regex: /\bAWS_SECRET_ACCESS_KEY\b[^\r\n]{0,40}(?:=|:)\s*["']?(?!\$|<|example|placeholder|test)[A-Za-z0-9/+]{20,}={0,2}/,
  },
  {
    name: 'Azure client secret assignment',
    regex: /\bAZURE_CLIENT_SECRET\b[^\r\n]{0,40}(?:=|:)\s*["']?(?!\$|<|example|placeholder|test)[A-Za-z0-9._-]{20,}/,
  },
  {
    name: 'Google API key',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/,
  },
];

function runGit(args, cwd = process.cwd()) {
  return spawnSync('git', args, { encoding: 'utf8', cwd });
}

function gitLines(args, allowExitCodes = [0], cwd = process.cwd()) {
  const result = runGit(args, cwd);
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

function isLikelyBinary(content) {
  return content.includes('\0');
}

function scanContentForCredentials(filePath, content) {
  if (content.includes(ALLOW_CREDENTIAL_SCAN_MARKER)) {
    return [];
  }

  const findings = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push(`${filePath}:${index + 1}: credential-like content detected (${pattern.name})`);
      }
    }
  }

  return findings;
}

function scanTrackedFilesForCredentials(rootDir = process.cwd()) {
  const trackedFiles = gitLines(['ls-files'], [0], rootDir);
  const findings = [];

  for (const relativePath of trackedFiles) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      continue;
    }

    if (isLikelyBinary(content)) {
      continue;
    }

    findings.push(...scanContentForCredentials(relativePath, content));
  }

  return findings;
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

  failures.push(...scanTrackedFilesForCredentials());

  if (failures.length > 0) {
    fail(failures);
  }

  console.log('Hygiene check passed.');
}

module.exports = {
  ALLOW_CREDENTIAL_SCAN_MARKER,
  scanContentForCredentials,
  scanTrackedFilesForCredentials,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('Hygiene check failed with runtime error:');
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  }
}

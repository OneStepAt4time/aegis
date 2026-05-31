#!/usr/bin/env node
/**
 * scripts/clickable-gate.cjs
 * Scans changed .tsx files in dashboard/src/ and reports JSX elements that:
 *   - have `cursor-pointer` class OR a `hover:bg-` Tailwind class
 *   - but NO onClick, href, to, type="button", type="submit", or semantic tag (<a>, <button>, <Link>)
 * Exits 1 if violations > 0 (excluding allowlisted files).
 * Pass `--all` to audit the full dashboard tree.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

// Resolve repo root by finding .git directory upward from cwd.
// This allows the script to scan a worktree instead of the main repo
// when executed from within a worktree directory.
function findRepoRoot(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '..');
}

const REPO_ROOT = findRepoRoot(process.cwd());
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts', 'clickable-gate.allowlist.txt');
const SCAN_DIR = path.join(REPO_ROOT, 'dashboard', 'src');

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return new Set();
  return new Set(
    fs.readFileSync(ALLOWLIST_PATH, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  );
}

function collectTsxFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsxFiles(full, files);
    } else if (entry.name.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    const details = (result.stderr || '').trim() || (result.stdout || '').trim() || `exit code ${result.status}`;
    console.error(`git ${args.join(' ')} failed: ${details}`);
    process.exit(1);
  }
  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ensureBase(base) {
  let baseCheck = spawnSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  if (baseCheck.status !== 0 && base === 'origin/develop') {
    spawnSync('git', ['fetch', 'origin', 'develop', '--quiet'], { cwd: REPO_ROOT, stdio: 'inherit' });
    baseCheck = spawnSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  }

  if (baseCheck.status !== 0) {
    const details = (baseCheck.stderr || '').trim() || (baseCheck.stdout || '').trim() || `exit code ${baseCheck.status}`;
    console.error(`Unable to resolve ${base}: ${details}`);
    process.exit(1);
  }
}

function collectChangedTsxFiles() {
  const base = 'origin/develop';
  const files = new Set();
  const root = 'dashboard/src';
  ensureBase(base);

  const collect = (args) => {
    for (const file of runGit(args)) {
      if (!file.endsWith('.tsx')) continue;
      if (!file.replace(/\\/g, '/').startsWith(`${root}/`)) continue;
      files.add(path.join(REPO_ROOT, file));
    }
  };

  collect(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`, '--', root]);
  collect(['diff', '--name-only', '--diff-filter=ACMR', '--', root]);
  collect(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--', root]);
  collect(['ls-files', '--others', '--exclude-standard', '--', root]);

  return [...files].filter((file) => fs.existsSync(file));
}

/**
 * Very lightweight check: scan line by line for JSX opening tags that have
 * cursor-pointer or hover:bg- in their className but no interactive attribute.
 *
 * We look at multi-line tag blocks by joining adjacent lines until `>` or `/>` closes the tag.
 */
function checkFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const violations = [];

  // Regex to detect start of JSX element (non-self-closing or multi-line)
  // We'll build "tag blocks" by accumulating lines until the tag closes.
  let tagBuffer = '';
  let tagStartLine = -1;
  let inTag = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inTag) {
      // Detect opening of a JSX tag: < followed by identifier or capital letter
      const tagMatch = line.match(/^\s*<([a-zA-Z][a-zA-Z0-9.]*)/);
      if (tagMatch) {
        inTag = true;
        tagBuffer = line;
        tagStartLine = i + 1;
        depth = (line.match(/</g) || []).length - (line.match(/>/g) || []).length;
        // If the tag already closes on the same line
        if (line.includes('>') || line.includes('/>')) {
          inTag = false;
          analyzeTag(tagBuffer, filePath, tagStartLine, violations);
          tagBuffer = '';
        }
      }
    } else {
      tagBuffer += '\n' + line;
      if (line.includes('>') || line.includes('/>')) {
        inTag = false;
        analyzeTag(tagBuffer, filePath, tagStartLine, violations);
        tagBuffer = '';
      }
    }
  }

  return violations;
}

const INTERACTIVE_PATTERNS = [
  /\bonClick\b/,
  /\bhref\b/,
  /\bto\b=/,
  /type=["']button["']/,
  /type=["']submit["']/,
  /type=["']reset["']/,
  /\brole=["']button["']/,
  /\btabIndex\b/,
];

const SEMANTIC_TAGS = /^<(a|button|Link|NavLink|input|select|textarea)\b/i;

function analyzeTag(block, filePath, lineNum, violations) {
  // Must have cursor-pointer or hover:bg-
  const hasCursorPointer = /cursor-pointer/.test(block);
  const hasHoverBg = /hover:bg-/.test(block);
  if (!hasCursorPointer && !hasHoverBg) return;

  // Is it a semantic interactive tag?
  const trimmed = block.trimStart();
  if (SEMANTIC_TAGS.test(trimmed)) return;

  // Does it have an interactive prop?
  for (const pat of INTERACTIVE_PATTERNS) {
    if (pat.test(block)) return;
  }

  violations.push({ file: filePath, line: lineNum, snippet: block.split('\n')[0].trim().slice(0, 80) });
}

function main() {
  const args = new Set(process.argv.slice(2));
  const allowlist = loadAllowlist();
  const files = args.has('--all') ? collectTsxFiles(SCAN_DIR) : collectChangedTsxFiles();
  const allViolations = [];

  for (const file of files) {
    // Normalize to relative path using forward slashes for allowlist comparison
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    if (allowlist.has(rel)) continue;

    const violations = checkFile(file);
    allViolations.push(...violations.map((v) => ({ ...v, rel })));
  }

  if (allViolations.length === 0) {
    console.log('✅  clickable-gate: no violations found');
    process.exit(0);
  }

  console.error(`❌  clickable-gate: ${allViolations.length} violation(s) found\n`);
  for (const v of allViolations) {
    console.error(`  ${v.rel}:${v.line}  →  ${v.snippet}`);
  }
  console.error(`\nTo allowlist a file, add its path to scripts/clickable-gate.allowlist.txt`);
  process.exit(1);
}

main();

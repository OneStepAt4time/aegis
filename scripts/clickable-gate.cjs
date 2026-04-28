#!/usr/bin/env node
/**
 * scripts/clickable-gate.cjs
 * Scans all .tsx files in dashboard/src/ and reports JSX elements that:
 *   - have `cursor-pointer` class OR a `hover:bg-` Tailwind class
 *   - but NO onClick, href, to, type="button", type="submit", or semantic tag (<a>, <button>, <Link>)
 * Exits 1 if violations > 0 (excluding allowlisted files).
 */

'use strict';

const fs = require('fs');
const path = require('path');

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
  const allowlist = loadAllowlist();
  const files = collectTsxFiles(SCAN_DIR);
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

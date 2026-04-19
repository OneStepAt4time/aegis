#!/usr/bin/env node
/**
 * scripts/dashboard-icons-audit.cjs
 *
 * Reporter (NOT a gate) that scans dashboard/src for emoji / unicode glyphs
 * used as icons. The output feeds follow-up migration PRs that replace each
 * occurrence with <Icon /> from dashboard/src/components/Icon.tsx.
 *
 * Scope:
 *   - Includes:  dashboard/src/**\/*.{ts,tsx}
 *   - Excludes:  **\/__tests__\/**, **\/design\/**, Icon.tsx, StatusDot.tsx
 *
 * Output:
 *   1. scripts/dashboard-icons-audit.current.txt
 *      Machine-readable: `<relpath>:<line>:<col>:<glyph>` (one per line).
 *   2. stdout — human-readable summary grouped by file.
 *
 * Exit code is always 0 (informational).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DASHBOARD_SRC = path.join(REPO_ROOT, 'dashboard', 'src');
const OUTPUT_FILE = path.join(__dirname, 'dashboard-icons-audit.current.txt');

const EXCLUDED_DIRS = new Set(['__tests__', 'design', 'node_modules', 'dist']);
const EXCLUDED_FILES = new Set(['Icon.tsx', 'StatusDot.tsx']);

// Explicit glyph list from the issue spec (plus the emoji code-point ranges).
const EXPLICIT_GLYPHS = new Set([
  '\u2295', // ⊕
  '\u26A0', // ⚠
  '\u26A1', // ⚡
  '\u2318', // ⌘
  '\u25CF', // ●
  '\u25CB', // ○
  '\u23F1', // ⏱
  '\u{1F4AC}', // 💬
  '\u{1F527}', // 🔧
  '\u2705', // ✅
  '\u{1F504}', // 🔄
  '\u{1F31E}', // 🌞
  '\u{1F319}', // 🌙
  '\u{1F4F8}', // 📸
  '\u2386', // ⎆
  '\u2B07', // ⬇
  '\u25A0', // ■
  '\u25FC', // ◼
]);

/** Returns true when a code point is in one of the icon-y emoji ranges. */
function isEmojiLike(cp) {
  return (
    (cp >= 0x1f300 && cp <= 0x1f6ff) ||
    (cp >= 0x1f900 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf)
  );
}

function shouldVisit(entry) {
  if (entry.isDirectory()) return !EXCLUDED_DIRS.has(entry.name);
  if (!entry.isFile()) return false;
  if (EXCLUDED_FILES.has(entry.name)) return false;
  return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');
}

function walk(dir, acc) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!shouldVisit(entry)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/**
 * Scan a file and return [{line, col, glyph}].
 * Uses for-of on the string so surrogate pairs are handled as a single glyph.
 */
function scanFile(contents) {
  const hits = [];
  const lines = contents.split(/\r?\n/);
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let col = 1;
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      if (cp > 0x7f) {
        if (EXPLICIT_GLYPHS.has(ch) || isEmojiLike(cp)) {
          hits.push({ line: lineIdx + 1, col, glyph: ch });
        }
      }
      // Surrogate pairs count as two JS units but one glyph; col tracks glyphs.
      col += 1;
    }
  }
  return hits;
}

function main() {
  if (!fs.existsSync(DASHBOARD_SRC)) {
    console.error(`[audit] dashboard/src not found at ${DASHBOARD_SRC}`);
    process.exit(0);
  }

  const files = walk(DASHBOARD_SRC, []);
  /** @type {Array<{file: string, hits: Array<{line:number,col:number,glyph:string}>}>} */
  const byFile = [];
  let totalHits = 0;
  const distinct = new Set();

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    const contents = fs.readFileSync(file, 'utf8');
    const hits = scanFile(contents);
    if (hits.length === 0) continue;
    byFile.push({ file: rel, hits });
    totalHits += hits.length;
    for (const h of hits) distinct.add(h.glyph);
  }

  // Machine-readable list.
  const lines = [];
  for (const { file, hits } of byFile) {
    for (const h of hits) {
      lines.push(`${file}:${h.line}:${h.col}:${h.glyph}`);
    }
  }
  fs.writeFileSync(OUTPUT_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');

  // Human summary.
  console.log('Dashboard icon audit — emoji / unicode glyphs used as icons');
  console.log('-----------------------------------------------------------');
  console.log(`Files scanned:        ${files.length}`);
  console.log(`Files with glyphs:    ${byFile.length}`);
  console.log(`Total occurrences:    ${totalHits}`);
  console.log(`Distinct glyphs:      ${distinct.size}`);
  console.log(`List written to:      ${path.relative(REPO_ROOT, OUTPUT_FILE).split(path.sep).join('/')}`);
  console.log('');
  if (byFile.length === 0) {
    console.log('No offending glyphs found.');
    return;
  }
  console.log('Per-file breakdown:');
  for (const { file, hits } of byFile) {
    const glyphs = Array.from(new Set(hits.map((h) => h.glyph))).join(' ');
    console.log(`  ${file}  (${hits.length} occurrence${hits.length === 1 ? '' : 's'}: ${glyphs})`);
  }
}

main();

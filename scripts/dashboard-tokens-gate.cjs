#!/usr/bin/env node
/**
 * Dashboard Design-Tokens Gate (issue dashboard-perfection #016).
 *
 * Scans `dashboard/src/components/**` and `dashboard/src/pages/**` for raw
 * design values that should live in `dashboard/src/design/tokens.ts` instead:
 *
 *   - hex color literals      (#rgb, #rrggbb, #rrggbbaa)
 *   - rgb() / rgba() / hsl() / hsla() literals
 *   - raw cubic-bezier() literals
 *   - tailwind `duration-<number>` classes (e.g. `duration-200`)
 *
 * Exceptions:
 *   - Any file in `dashboard/src/design/` (source of truth).
 *   - Any line containing `// token-ok` or `{/* token-ok *\/}` — inline escape.
 *   - Any file listed in `scripts/dashboard-tokens-gate.allowlist.txt`.
 *
 * The allowlist is scaffolding for the initial migration. Follow-up PRs
 * remove entries as components adopt the tokens module.
 *
 * Runtime target: well under 2s on a typical laptop. No deps — pure Node.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'dashboard', 'src', 'components'),
  path.join(REPO_ROOT, 'dashboard', 'src', 'pages'),
];
const ALLOWLIST_FILE = path.join(
  REPO_ROOT,
  'scripts',
  'dashboard-tokens-gate.allowlist.txt',
);

// Violation patterns — each scanned per-line, not multiline.
// Order matters only for summary grouping.
const PATTERNS = [
  {
    id: 'hex-color',
    // Hex literal that looks like a color: #rgb / #rrggbb / #rrggbbaa,
    // preceded by a non-word boundary (so we don't catch things like "abc#123"
    // inside a URL fragment or a hash id).
    regex: /(?<![A-Za-z0-9_])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
    message: 'Raw hex color literal — use tokens.color.* instead',
  },
  {
    id: 'rgb-color',
    regex: /\brgba?\s*\(/g,
    message: 'Raw rgb()/rgba() literal — use tokens.color.* or CSS var',
  },
  {
    id: 'hsl-color',
    regex: /\bhsla?\s*\(/g,
    message: 'Raw hsl()/hsla() literal — use tokens.color.* or CSS var',
  },
  {
    id: 'cubic-bezier',
    regex: /\bcubic-bezier\s*\(/g,
    message: 'Raw cubic-bezier() — use tokens.easing.* or var(--ease-*)',
  },
  {
    id: 'tailwind-duration',
    // Tailwind class like `duration-200` or `duration-[320ms]` — force
    // developers through `tokens.duration.*` / `var(--duration-*)`.
    regex: /\bduration-(?:\d+|\[\d+(?:ms|s)?\])\b/g,
    message: 'Tailwind duration-<n> — use tokens.duration.* or var(--duration-*)',
  },
];

// ----------------------------------------------------------------------------
// Filesystem walking
// ----------------------------------------------------------------------------

/**
 * @param {string} root
 * @returns {string[]} absolute paths to .ts/.tsx files
 */
function walk(root) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        if (/\.(tsx?|mts|cts)$/i.test(entry.name)) out.push(abs);
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Allowlist
// ----------------------------------------------------------------------------

/** @returns {Set<string>} relative POSIX-style paths */
function loadAllowlist() {
  const allowed = new Set();
  if (!fs.existsSync(ALLOWLIST_FILE)) return allowed;
  const raw = fs.readFileSync(ALLOWLIST_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    allowed.add(trimmed.replace(/\\/g, '/'));
  }
  return allowed;
}

/** @param {string} abs */
function toRepoRelative(abs) {
  return path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
}

// ----------------------------------------------------------------------------
// Scanner
// ----------------------------------------------------------------------------

/**
 * @param {string} absPath
 * @returns {Array<{file: string; line: number; col: number; patternId: string; message: string; snippet: string}>}
 */
function scanFile(absPath) {
  const rel = toRepoRelative(absPath);
  // Never scan the tokens source of truth.
  if (rel.includes('dashboard/src/design/')) return [];

  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\/\/\s*token-ok\b/.test(line)) continue;
    if (/\{\s*\/\*\s*token-ok\b/.test(line)) continue;

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        violations.push({
          file: rel,
          line: i + 1,
          col: match.index + 1,
          patternId: pattern.id,
          message: pattern.message,
          snippet: line.trim().slice(0, 140),
        });
      }
    }
  }
  return violations;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main() {
  const started = Date.now();
  const args = new Set(process.argv.slice(2));
  const emitAllowlist = args.has('--write-allowlist');

  const allowlist = loadAllowlist();

  /** @type {Array<ReturnType<typeof scanFile>[number]>} */
  const allViolations = [];
  let fileCount = 0;

  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      fileCount++;
      const rel = toRepoRelative(file);
      if (allowlist.has(rel)) continue;
      const found = scanFile(file);
      if (found.length > 0) allViolations.push(...found);
    }
  }

  const elapsed = Date.now() - started;

  if (emitAllowlist) {
    // Collect every file that currently violates — used to seed the allowlist.
    const violatingFiles = new Set();
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const found = scanFile(file);
        if (found.length > 0) violatingFiles.add(toRepoRelative(file));
      }
    }
    const sorted = [...violatingFiles].sort();
    const header = [
      '# dashboard-tokens-gate — migration allowlist',
      '#',
      '# This allowlist is scaffolding for issue 016 (dashboard-perfection epic).',
      '# Entries are removed one-by-one by follow-up PRs that migrate',
      '# components to `dashboard/src/design/tokens.ts`.',
      '#',
      '# Do NOT add new entries. New components must use tokens from day one.',
      '# Lines starting with `#` are comments. Paths are repo-relative, forward-slash.',
      '',
    ].join('\n');
    const body = sorted.join('\n') + (sorted.length ? '\n' : '');
    fs.writeFileSync(ALLOWLIST_FILE, header + body, 'utf8');
    console.log(
      `[tokens-gate] Wrote ${sorted.length} files to ${path.relative(REPO_ROOT, ALLOWLIST_FILE).replace(/\\/g, '/')}`,
    );
    console.log(`[tokens-gate] Scanned ${fileCount} files in ${elapsed}ms`);
    process.exit(0);
  }

  if (allViolations.length === 0) {
    console.log(
      `[tokens-gate] OK — scanned ${fileCount} files (${allowlist.size} allow-listed) in ${elapsed}ms`,
    );
    process.exit(0);
  }

  // Group violations by file for a readable summary.
  /** @type {Map<string, typeof allViolations>} */
  const byFile = new Map();
  for (const v of allViolations) {
    const bucket = byFile.get(v.file) ?? [];
    bucket.push(v);
    byFile.set(v.file, bucket);
  }

  console.error('[tokens-gate] FAIL — design-token violations detected:\n');
  for (const [file, list] of [...byFile.entries()].sort()) {
    console.error(`  ${file}`);
    for (const v of list) {
      console.error(`    ${v.line}:${v.col}  [${v.patternId}]  ${v.message}`);
      console.error(`      > ${v.snippet}`);
    }
  }
  console.error(
    `\n[tokens-gate] ${allViolations.length} violation(s) across ${byFile.size} file(s). ` +
      `Use \`// token-ok\` to allowlist an intentional line, or migrate to ` +
      `\`dashboard/src/design/tokens.ts\`. See docs/dashboard/design-tokens.md.`,
  );
  console.error(`[tokens-gate] Scanned ${fileCount} files in ${elapsed}ms`);
  process.exit(1);
}

main();

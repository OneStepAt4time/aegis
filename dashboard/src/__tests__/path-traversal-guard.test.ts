/**
 * __tests__/path-traversal-guard.test.ts
 *
 * Defense-in-depth companion to #4647 (path-traversal finding in
 * src/plugins/dashboard-static.ts). The actual fix lives server-side
 * in Hep's safeJoinDashboardPath chokepoint (or option 3 — drop the
 * manual statSync entirely and let @fastify/static handle Content-Length).
 * This test guards against the React app ever *requesting* a
 * traversal-shaped URL, which would defeat the server's allowlist
 * regardless of which fix shape lands.
 *
 * If a developer adds a hardcoded `..` path (e.g. <a href="..">,
 * navigate("/dashboard/../etc"), window.location.href = "../foo"),
 * this test fails with the file and line.
 *
 * This is a static-analysis regression guard, not a unit test of new
 * behavior. It passes from the start because the dashboard currently
 * doesn't emit traversal URLs; the value is in catching future
 * regressions introduced by either human edits or AI-generated code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DASHBOARD_SRC = join(__dirname, '..');
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'dist', 'coverage']);

interface Hit {
  file: string;
  line: number;
  literal: string;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      yield* walk(full);
    } else {
      const ext = entry.slice(entry.lastIndexOf('.'));
      if (SCAN_EXTENSIONS.has(ext)) yield full;
    }
  }
}

/**
 * Detect path-traversal patterns in a string literal:
 * - exact-match ".." or "..\"
 * - starts with "../" or "..\"
 * - contains "/../" or "\..\"
 */
function isTraversalLiteral(literal: string): boolean {
  if (literal === '..' || literal === '..\\') return true;
  if (literal.startsWith('../') || literal.startsWith('..\\')) return true;
  if (literal.includes('/../') || literal.includes('\\..\\')) return true;
  return false;
}

const STRING_LITERAL_PATTERNS: Array<{ re: RegExp; group: 1 | 2 }> = [
  { re: /'((?:[^'\\]|\\.)*)'/g, group: 1 },
  { re: /"((?:[^"\\]|\\.)*)"/g, group: 1 },
  { re: /`((?:[^`\\]|\\.)*)`/g, group: 1 },
];

/**
 * Decide if a string literal is an ES module specifier (import / export /
 * dynamic import / require / vi.mock) and should therefore not be treated
 * as a URL. Conservative: only skips when the literal itself looks like a
 * relative path AND the line contains a known import-context keyword.
 */
function isModuleSpecifier(line: string, literal: string): boolean {
  if (!literal.startsWith('./') && !literal.startsWith('../')) return false;
  if (/\bfrom\s+['"`]/.test(line)) return true;
  if (/\bimport\s*\(/.test(line)) return true;
  if (/\brequire\s*\(/.test(line)) return true;
  if (/\bvi\.\w+\s*\(/.test(line)) return true;
  return false;
}

function findTraversalLiterals(file: string): Hit[] {
  const source = readFileSync(file, 'utf8');
  // Strip comments but preserve newlines so line numbers stay aligned.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) =>
      p1 + ' '.repeat(m.length - p1.length),
    );

  const hits: Hit[] = [];
  const lines = stripped.split('\n');
  const relFile = relative(DASHBOARD_SRC, file);

  lines.forEach((line, idx) => {
    for (const { re, group } of STRING_LITERAL_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const literal = m[group];
        if (!isTraversalLiteral(literal)) continue;
        if (isModuleSpecifier(line, literal)) continue;
        hits.push({ file: relFile, line: idx + 1, literal });
      }
    }
  });

  return hits;
}

describe('Path-traversal guard (companion to #4647)', () => {
  const files = [...walk(DASHBOARD_SRC)];
  const allHits: Hit[] = [];

  for (const file of files) {
    allHits.push(...findTraversalLiterals(file));
  }

  it('no React source file contains a `..` traversal path literal', () => {
    if (allHits.length > 0) {
      const summary = allHits
        .map((h) => `  ${h.file}:${h.line}  ${JSON.stringify(h.literal)}`)
        .join('\n');
      throw new Error(
        `Found ${allHits.length} traversal-shaped path literal(s) in dashboard source:\n${summary}\n\n` +
          `The server-side allowlist in src/plugins/dashboard-static.ts (issue #4647) ` +
          `rejects such paths, but the React app should never produce them in the first place. ` +
          `Use React Router's <Link to> or navigate() with an absolute path under ` +
          `/, /dashboard/, /assets/, or another allowlisted prefix.`,
      );
    }
    expect(allHits).toEqual([]);
  });
});

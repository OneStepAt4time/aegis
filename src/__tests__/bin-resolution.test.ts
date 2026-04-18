/**
 * bin-resolution.test.ts — Issue #1929.
 *
 * Ensures both `ag` (primary) and `aegis` (alias) bin entries resolve to the
 * same CLI entry point, so existing scripts using `aegis` keep working after
 * the primary CLI switch to `ag`.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
  bin?: Record<string, string>;
};
const agBin = pkg.bin?.ag ? join(repoRoot, pkg.bin.ag) : '';
const aegisBin = pkg.bin?.aegis ? join(repoRoot, pkg.bin.aegis) : '';

describe('package.json bin entries (#1929)', () => {
  it('exposes the `ag` primary bin', () => {
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin?.ag).toBe('dist/cli.js');
  });

  it('retains the `aegis` alias bin for backward compatibility', () => {
    expect(pkg.bin?.aegis).toBe('dist/cli.js');
  });

  it('points both bins at the same CLI entry point', () => {
    expect(pkg.bin?.ag).toBe(pkg.bin?.aegis);
  });

  it('resolves both bins to the same existing CLI file', () => {
    expect(existsSync(agBin)).toBe(true);
    expect(existsSync(aegisBin)).toBe(true);
    expect(realpathSync(agBin)).toBe(realpathSync(aegisBin));
  });
});

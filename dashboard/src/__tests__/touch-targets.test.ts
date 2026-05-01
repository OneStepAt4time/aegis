/**
 * touch-targets.test.ts — Verify minimum mobile touch target sizes.
 * Issue #2350: Interactive controls should meet 44x44 CSS px minimum.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSrc(relativePath: string): string {
  return readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');
}

describe('Mobile touch targets (issue #2350)', () => {
  it('New Session button has min-h-[44px] and min-w-[44px]', () => {
    const src = readSrc('components/Layout.tsx');
    // Find the className near the New Session aria-label (within 5 lines)
    const lines = src.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('aria-label="New Session')) {
        // Search within 5 lines in both directions for className with min-h
        for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 5); j++) {
          if (lines[j].includes('className="') && lines[j].includes('min-h-[44px]')) {
            found = true;
            break;
          }
        }
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });

  it('Theme toggle button has min-h-[44px] and min-w-[44px]', () => {
    const src = readSrc('components/Layout.tsx');
    // The theme toggle className should have min-h-[44px]
    expect(src).toMatch(/min-h-\[44px\].*min-w-\[44px\].*text-slate-500.*transition-colors.*hover:bg-slate-100/s);
  });

  it('Sign out button has min-h-[44px]', () => {
    const src = readSrc('components/Layout.tsx');
    expect(src).toMatch(/px-3 py-3 min-h-\[44px\].*text-sm font-medium/);
  });

  it('Login show/hide token button has min-h-[44px] and min-w-[44px]', () => {
    const src = readSrc('pages/LoginPage.tsx');
    expect(src).toContain('min-h-[44px]');
    expect(src).toContain('min-w-[44px]');
    // Verify it's on the eye/eyeoff button area
    expect(src).toMatch(/flex items-center justify-center p-2 min-h-\[44px\] min-w-\[44px\]/);
  });

  it('Session search input has min-h-[44px]', () => {
    const src = readSrc('components/overview/SessionTable.tsx');
    expect(src).toMatch(/py-3 min-h-\[44px\].*text-sm text-gray-300/);
  });

  it('Session tab buttons have min-h-[44px]', () => {
    const src = readSrc('pages/SessionsPage.tsx');
    const matches = src.match(/py-3 min-h-\[44px\]/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

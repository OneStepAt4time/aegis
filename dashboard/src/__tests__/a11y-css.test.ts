/**
 * a11y-css.test.ts — Snapshot/assertion tests for accessibility CSS rules in index.css.
 *
 * These tests verify that critical a11y CSS tokens and media queries are present in
 * the CSS source file. They run in Vitest (no browser needed).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, '../index.css');
const css = readFileSync(CSS_PATH, 'utf-8');

describe('index.css — focus ring tokens', () => {
  it('defines --focus-ring token', () => {
    expect(css).toContain('--focus-ring:');
  });

  it('defines --focus-ring-offset token', () => {
    expect(css).toContain('--focus-ring-offset:');
  });

  it('applies focus ring via :focus-visible', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('box-shadow: var(--focus-ring-offset), var(--focus-ring)');
  });

  it('removes outline for :focus:not(:focus-visible)', () => {
    expect(css).toContain(':focus:not(:focus-visible)');
    expect(css).toContain('outline: none');
  });
});

describe('index.css — media queries', () => {
  it('includes prefers-reduced-motion: reduce', () => {
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('animation-duration: 0.001ms');
    expect(css).toContain('transition-duration: 0.001ms');
  });

  it('includes prefers-reduced-transparency', () => {
    expect(css).toContain('prefers-reduced-transparency: reduce');
  });

  it('includes forced-colors: active', () => {
    expect(css).toContain('forced-colors: active');
    expect(css).toContain('ButtonText');
    expect(css).toContain('ButtonFace');
    expect(css).toContain('CanvasText');
    expect(css).toContain('Canvas');
  });

  it('includes prefers-contrast: more', () => {
    expect(css).toContain('prefers-contrast: more');
  });
});

describe('index.css — no hardcoded hex/rgb in focus-visible rule', () => {
  it('focus-visible rule body uses CSS vars, not hardcoded colors', () => {
    // Get just the box-shadow line in :focus-visible
    const match = css.match(/:focus-visible\s*\{([^}]+)\}/);
    expect(match).not.toBeNull();
    const ruleBody = match![1];
    // Should reference var() not #xxx or rgb()
    expect(ruleBody).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(ruleBody).not.toMatch(/\brgb\(/);
  });
});

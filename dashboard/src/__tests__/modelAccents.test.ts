/**
 * __tests__/modelAccents.test.ts — Issue 04.9 of the session-cockpit epic.
 *
 * The accent map is a pure key-by-family lookup. These tests pin the
 * family-detection heuristics so a future rename or regex tweak can't
 * silently collapse families together.
 */

import { describe, it, expect } from 'vitest';
import { modelAccent, modelFamily } from '../design/modelAccents';

describe('modelFamily', () => {
  const CASES: Array<[name: string, family: string]> = [
    ['claude-opus-4-7',              'opus'],
    ['claude-sonnet-4-6',            'sonnet'],
    ['claude-haiku-4-5-20251001',    'haiku'],
    ['gpt-4o-mini',                  'gpt'],
    ['o3',                           'gpt'],
    ['o4-mini',                      'gpt'],
    ['glm-5.1',                      'glm'],
    ['llama3.1:70b',                 'llama'],
    ['mistral-large-2411',           'mistral'],
    ['mixtral-8x22b',                'mistral'],
    ['qwen2.5-coder',                'qwen'],
    ['deepseek-v3',                  'deepseek'],
    ['unrecognized-future-model',    'unknown'],
    ['',                             'unknown'],
  ];

  for (const [name, family] of CASES) {
    it(`maps "${name || '<empty>'}" → ${family}`, () => {
      expect(modelFamily(name)).toBe(family);
    });
  }

  it('is null-safe', () => {
    expect(modelFamily(undefined)).toBe('unknown');
    expect(modelFamily(null)).toBe('unknown');
  });
});

describe('modelAccent', () => {
  it('returns a CSS var reference for every family', () => {
    expect(modelAccent('claude-opus-4-7')).toMatch(/^var\(--color-/);
    expect(modelAccent('glm-5.1')).toMatch(/^var\(--color-/);
    expect(modelAccent('unknown-foo')).toMatch(/^var\(--color-/);
  });

  it('returns distinct colors for Claude tiers', () => {
    const opus = modelAccent('claude-opus-4-7');
    const sonnet = modelAccent('claude-sonnet-4-6');
    const haiku = modelAccent('claude-haiku-4-5');
    expect(new Set([opus, sonnet, haiku]).size).toBe(3);
  });
});

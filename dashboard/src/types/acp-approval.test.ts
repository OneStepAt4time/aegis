import { describe, it, expect } from 'vitest';
import { RISK_LEVEL_CONFIG } from './acp-approval.js';

describe('RISK_LEVEL_CONFIG', () => {
  const levels = ['low', 'medium', 'high', 'critical'] as const;

  it('defines all four risk levels', () => {
    for (const level of levels) {
      expect(RISK_LEVEL_CONFIG[level]).toBeDefined();
    }
  });

  it.each(levels)('%s has label, bg, text, and border string fields', (level) => {
    const config = RISK_LEVEL_CONFIG[level];
    expect(typeof config.label).toBe('string');
    expect(typeof config.bg).toBe('string');
    expect(typeof config.text).toBe('string');
    expect(typeof config.border).toBe('string');
  });

  it.each(levels)('%s uses no raw bg-orange- classes', (level) => {
    const config = RISK_LEVEL_CONFIG[level];
    expect(config.bg).not.toMatch(/bg-orange-/);
    expect(config.text).not.toMatch(/text-orange-/);
    expect(config.border).not.toMatch(/border-orange-/);
  });

  it('high risk maps to warning design tokens', () => {
    const { bg, text, border } = RISK_LEVEL_CONFIG.high;
    expect(bg).toContain('--color-warning');
    expect(text).toContain('--color-warning');
    expect(border).toContain('--color-warning');
  });
});

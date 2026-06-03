import { describe, it, expect } from 'vitest';
import { ROLE_COLORS } from './acp-driver-observer.js';

describe('ROLE_COLORS', () => {
  const roles = ['driver', 'observer', 'operator', 'admin'] as const;

  it('defines all four display roles', () => {
    for (const role of roles) {
      expect(ROLE_COLORS[role]).toBeDefined();
    }
  });

  it.each(roles)('%s has bg and text string fields', (role) => {
    const colors = ROLE_COLORS[role];
    expect(typeof colors.bg).toBe('string');
    expect(typeof colors.text).toBe('string');
  });

  it.each(roles)('%s uses no raw bg-zinc- or text-zinc- classes', (role) => {
    const colors = ROLE_COLORS[role];
    expect(colors.bg).not.toMatch(/bg-zinc-/);
    expect(colors.text).not.toMatch(/text-zinc-/);
  });

  it('observer maps to info design tokens', () => {
    const { bg, text } = ROLE_COLORS.observer;
    expect(bg).toContain('--color-info');
    expect(text).toContain('--color-info');
  });
});

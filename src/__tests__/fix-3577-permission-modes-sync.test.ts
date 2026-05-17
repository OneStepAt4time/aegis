/**
 * #3577 — VALID_PERMISSION_MODES must match the Zod schema in routes/sessions.ts
 *
 * The Zod schema accepts: default, bypassPermissions, plan, acceptEdits, dontAsk, auto
 * hooks.ts VALID_PERMISSION_MODES must include all of them, or permission requests
 * silently fall back to "default" and auto-approve never triggers.
 */
import { describe, it, expect } from 'vitest';

// Re-extract VALID_PERMISSION_MODES from hooks.ts via dynamic import
// We test the Set contents directly by checking the hook behavior

// Read the source to verify consistency
import fs from 'fs';
import path from 'path';

const hooksSource = fs.readFileSync(path.resolve(__dirname, '../hooks.ts'), 'utf-8');
const sessionsSource = fs.readFileSync(path.resolve(__dirname, '../routes/sessions.ts'), 'utf-8');

describe('#3577: VALID_PERMISSION_MODES matches Zod schema', () => {
  const VALID_MODES_MATCH = hooksSource.match(
    /VALID_PERMISSION_MODES\s*=\s*new\s+Set\(\[([^\]]+)\]\)/
  );
  const ZOD_ENUM_MATCH = sessionsSource.match(
    /permissionMode:\s*z\.enum\(\[([^\]]+)\]\)/
  );

  it('should find VALID_PERMISSION_MODES in hooks.ts', () => {
    expect(VALID_MODES_MATCH).not.toBeNull();
  });

  it('should find permissionMode z.enum in sessions.ts', () => {
    expect(ZOD_ENUM_MATCH).not.toBeNull();
  });

  it('VALID_PERMISSION_MODES should contain all Zod enum values', () => {
    if (!VALID_MODES_MATCH || !ZOD_ENUM_MATCH) return;

    const parseValues = (s: string) =>
      s.split(',')
        .map(v => v.trim().replace(/['"]/g, ''))
        .filter(Boolean);

    const hookModes = parseValues(VALID_MODES_MATCH[1]);
    const zodModes = parseValues(ZOD_ENUM_MATCH[1]);

    for (const mode of zodModes) {
      expect(hookModes).toContain(mode);
    }
  });

  it('specifically includes auto, dontAsk, and acceptEdits', () => {
    if (!VALID_MODES_MATCH) return;
    const modes = VALID_MODES_MATCH[1];
    expect(modes).toContain('auto');
    expect(modes).toContain('dontAsk');
    expect(modes).toContain('acceptEdits');
  });
});

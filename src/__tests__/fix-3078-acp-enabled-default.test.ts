/**
 * fix-3078-acp-enabled-default.test.ts — Issue #3078:
 * acpEnabled should default to true so sessions use ACP when available.
 *
 * Previously defaulted to false — sessions created without CC transport
 * even when ACP binary was available. Now defaults to true.
 */

import { describe, it, expect } from 'vitest';

describe('acpEnabled default (#3078)', () => {
  it('is true in the default config object', async () => {
    // Read the source to verify the default — the 'defaults' object is not exported
    const fs = await import('fs');
    const path = await import('path');
    const configSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, '../config.ts'),
      'utf-8'
    );
    // Check that the default line is present (not "acpEnabled: false")
    const acpLine = configSrc.split('\n').find(l => /^\s*acpEnabled: (true|false),?\s*$/.test(l));
    expect(acpLine).toBeDefined();
    expect(acpLine!.trim()).toBe('acpEnabled: true,');
  });
});

/**
 * Issue #3078: acpEnabled should default to true so sessions
 * get ACP transport when the binary is available.
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

describe('Issue #3078 — acpEnabled defaults to true', () => {
  it('acpEnabled is true in default config', async () => {
    // loadConfig without AEGIS_ACP_ENABLED env var should return acpEnabled: true
    const original = process.env.AEGIS_ACP_ENABLED;
    delete process.env.AEGIS_ACP_ENABLED;
    try {
      const config = await loadConfig();
      expect(config.acpEnabled).toBe(true);
    } finally {
      if (original !== undefined) process.env.AEGIS_ACP_ENABLED = original;
    }
  });

  it('acpEnabled can be explicitly disabled via AEGIS_ACP_ENABLED=false', async () => {
    const original = process.env.AEGIS_ACP_ENABLED;
    process.env.AEGIS_ACP_ENABLED = 'false';
    try {
      const config = await loadConfig();
      expect(config.acpEnabled).toBe(false);
    } finally {
      if (original !== undefined) process.env.AEGIS_ACP_ENABLED = original;
      else delete process.env.AEGIS_ACP_ENABLED;
    }
  });
});

/**
 * Tests for loadTracingConfig — hostname/PID env var handling.
 *
 * Issue: Argus audit found the previous test defined a local loadConfig()
 * that duplicated loadTracingConfig() from src/tracing.ts. It never imported
 * the real function — test passed even if the real code broke.
 *
 * Fix: Import the real loadTracingConfig with module isolation so env changes
 * are picked up correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('loadTracingConfig — hostname/PID options', () => {
  const savedEnv: Record<string, string | undefined> = {};

  const otelKeys = [
    'AEGIS_OTEL_ENABLED',
    'AEGIS_OTEL_SERVICE_NAME',
    'AEGIS_OTEL_OTLP_ENDPOINT',
    'AEGIS_OTEL_SAMPLE_RATE',
    'AEGIS_OTEL_INCLUDE_HOSTNAME',
    'AEGIS_OTEL_INCLUDE_PID',
  ];

  beforeEach(() => {
    for (const key of otelKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of otelKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    vi.resetModules();
  });

  /** Import the real loadTracingConfig with fresh module cache. */
  async function loadRealConfig() {
    const { loadTracingConfig } = await import('../tracing.js');
    return loadTracingConfig();
  }

  it('defaults includeHostname to true', async () => {
    const config = await loadRealConfig();
    expect(config.includeHostname).toBe(true);
  });

  it('defaults includePid to true', async () => {
    const config = await loadRealConfig();
    expect(config.includePid).toBe(true);
  });

  it('sets includeHostname to false when AEGIS_OTEL_INCLUDE_HOSTNAME=false', async () => {
    process.env.AEGIS_OTEL_INCLUDE_HOSTNAME = 'false';
    const config = await loadRealConfig();
    expect(config.includeHostname).toBe(false);
  });

  it('sets includePid to false when AEGIS_OTEL_INCLUDE_PID=false', async () => {
    process.env.AEGIS_OTEL_INCLUDE_PID = 'false';
    const config = await loadRealConfig();
    expect(config.includePid).toBe(false);
  });

  it('keeps includeHostname true for non-"false" values', async () => {
    process.env.AEGIS_OTEL_INCLUDE_HOSTNAME = 'yes';
    const config = await loadRealConfig();
    expect(config.includeHostname).toBe(true);
  });

  it('keeps includePid true for non-"false" values', async () => {
    process.env.AEGIS_OTEL_INCLUDE_PID = '0';
    const config = await loadRealConfig();
    expect(config.includePid).toBe(true);
  });

  it('both can be disabled simultaneously', async () => {
    process.env.AEGIS_OTEL_INCLUDE_HOSTNAME = 'false';
    process.env.AEGIS_OTEL_INCLUDE_PID = 'false';
    const config = await loadRealConfig();
    expect(config.includeHostname).toBe(false);
    expect(config.includePid).toBe(false);
  });
});

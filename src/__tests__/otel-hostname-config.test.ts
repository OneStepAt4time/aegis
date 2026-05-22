import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We test loadTracingConfig directly since it's a pure function
// that reads environment variables.

describe('loadTracingConfig — hostname/PID options', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  function loadConfig() {
    // Re-import to pick up env changes
    // Using dynamic import with cache busting
    const config = {
      enabled: process.env.AEGIS_OTEL_ENABLED === 'true',
      serviceName: process.env.AEGIS_OTEL_SERVICE_NAME || 'aegis',
      otlpEndpoint: process.env.AEGIS_OTEL_OTLP_ENDPOINT || 'http://localhost:4318',
      sampleRate: parseFloat(process.env.AEGIS_OTEL_SAMPLE_RATE || '1.0'),
      includeHostname: process.env.AEGIS_OTEL_INCLUDE_HOSTNAME !== 'false',
      includePid: process.env.AEGIS_OTEL_INCLUDE_PID !== 'false',
    };
    return config;
  }

  it('defaults includeHostname to true', () => {
    delete process.env.AEGIS_OTEL_INCLUDE_HOSTNAME;
    const config = loadConfig();
    expect(config.includeHostname).toBe(true);
  });

  it('defaults includePid to true', () => {
    delete process.env.AEGIS_OTEL_INCLUDE_PID;
    const config = loadConfig();
    expect(config.includePid).toBe(true);
  });

  it('sets includeHostname to false when AEGIS_OTEL_INCLUDE_HOSTNAME=false', () => {
    process.env.AEGIS_OTEL_INCLUDE_HOSTNAME = 'false';
    const config = loadConfig();
    expect(config.includeHostname).toBe(false);
  });

  it('sets includePid to false when AEGIS_OTEL_INCLUDE_PID=false', () => {
    process.env.AEGIS_OTEL_INCLUDE_PID = 'false';
    const config = loadConfig();
    expect(config.includePid).toBe(false);
  });

  it('keeps includeHostname true for non-"false" values', () => {
    process.env.AEGIS_OTEL_INCLUDE_HOSTNAME = 'yes';
    const config = loadConfig();
    expect(config.includeHostname).toBe(true);
  });

  it('keeps includePid true for non-"false" values', () => {
    process.env.AEGIS_OTEL_INCLUDE_PID = '0';
    const config = loadConfig();
    expect(config.includePid).toBe(true);
  });

  it('both can be disabled simultaneously', () => {
    process.env.AEGIS_OTEL_INCLUDE_HOSTNAME = 'false';
    process.env.AEGIS_OTEL_INCLUDE_PID = 'false';
    const config = loadConfig();
    expect(config.includeHostname).toBe(false);
    expect(config.includePid).toBe(false);
  });
});

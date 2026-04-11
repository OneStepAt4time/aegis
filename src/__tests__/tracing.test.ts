/**
 * tracing.test.ts — Unit tests for OpenTelemetry tracing module.
 *
 * Issue #1417: OpenTelemetry tracing — research spike.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('tracing', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clean env vars
    delete process.env.AEGIS_OTEL_ENABLED;
    delete process.env.AEGIS_OTEL_SERVICE_NAME;
    delete process.env.AEGIS_OTEL_OTLP_ENDPOINT;
    delete process.env.AEGIS_OTEL_SAMPLE_RATE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadTracingConfig', () => {
    it('returns disabled by default', async () => {
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.enabled).toBe(false);
    });

    it('returns enabled when AEGIS_OTEL_ENABLED=true', async () => {
      process.env.AEGIS_OTEL_ENABLED = 'true';
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.enabled).toBe(true);
    });

    it('reads AEGIS_OTEL_SERVICE_NAME', async () => {
      process.env.AEGIS_OTEL_SERVICE_NAME = 'aegis-prod';
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.serviceName).toBe('aegis-prod');
    });

    it('reads AEGIS_OTEL_OTLP_ENDPOINT', async () => {
      process.env.AEGIS_OTEL_OTLP_ENDPOINT = 'http://jaeger:4318';
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.otlpEndpoint).toBe('http://jaeger:4318');
    });

    it('reads AEGIS_OTEL_SAMPLE_RATE', async () => {
      process.env.AEGIS_OTEL_SAMPLE_RATE = '0.5';
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.sampleRate).toBe(0.5);
    });

    it('defaults serviceName to "aegis"', async () => {
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.serviceName).toBe('aegis');
    });

    it('defaults otlpEndpoint to localhost:4318', async () => {
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.otlpEndpoint).toBe('http://localhost:4318');
    });

    it('defaults sampleRate to 1.0', async () => {
      const { loadTracingConfig } = await import('../tracing.js');
      const config = loadTracingConfig();
      expect(config.sampleRate).toBe(1.0);
    });
  });

  describe('initTracing (disabled)', () => {
    it('returns no-op tracer when disabled', async () => {
      const { initTracing, isTracingEnabled } = await import('../tracing.js');
      const tracer = await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      expect(tracer).toBeDefined();
      expect(isTracingEnabled()).toBe(false);
    });

    it('no-op tracer creates non-recording spans', async () => {
      const { initTracing } = await import('../tracing.js');
      const tracer = await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const span = tracer.startSpan('test.span');
      expect(span.isRecording()).toBe(false);
      span.end(); // should not throw
    });

    it('no-op startActiveSpan does not throw', async () => {
      const { initTracing } = await import('../tracing.js');
      const tracer = await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const result = tracer.startActiveSpan('test.active', (span) => {
        expect(span.isRecording()).toBe(false);
        return 42;
      });
      expect(result).toBe(42);
    });

    it('getTracer returns no-op tracer when disabled', async () => {
      const { initTracing, getTracer } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const tracer = getTracer();
      const span = tracer.startSpan('test');
      expect(span.isRecording()).toBe(false);
    });
  });

  describe('span helpers', () => {
    it('startSessionSpan creates non-recording span when tracing is off', async () => {
      const { initTracing, startSessionSpan } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const span = startSessionSpan('create', 'session-123', { workDir: '/tmp/test' });
      expect(span.isRecording()).toBe(false);
      span.end();
    });

    it('startTmuxSpan creates non-recording span when tracing is off', async () => {
      const { initTracing, startTmuxSpan } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const span = startTmuxSpan('send-keys', '@0');
      expect(span.isRecording()).toBe(false);
      span.end();
    });

    it('startMonitorSpan creates non-recording span when tracing is off', async () => {
      const { initTracing, startMonitorSpan } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const span = startMonitorSpan('poll');
      expect(span.isRecording()).toBe(false);
      span.end();
    });

    it('spanError does not throw on no-op span', async () => {
      const { initTracing, startSessionSpan, spanError } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const span = startSessionSpan('create', 's-1');
      expect(() => spanError(span, new Error('test error'))).not.toThrow();
      span.end();
    });

    it('spanOk does not throw on no-op span', async () => {
      const { initTracing, startSessionSpan, spanOk } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const span = startSessionSpan('create', 's-1');
      expect(() => spanOk(span, 'created')).not.toThrow();
      span.end();
    });
  });

  describe('initTracing (enabled — SDK load failure)', () => {
    it('falls back to no-op when SDK import fails', async () => {
      // Mock the dynamic import to throw
      vi.doMock('@opentelemetry/sdk-node', () => {
        throw new Error('Module not found');
      });

      const { initTracing, isTracingEnabled } = await import('../tracing.js');
      const tracer = await initTracing({
        enabled: true,
        serviceName: 'test',
        otlpEndpoint: 'http://localhost:4318',
        sampleRate: 1.0,
      });

      expect(tracer).toBeDefined();
      expect(isTracingEnabled()).toBe(false);
    });
  });

  describe('shutdownTracing', () => {
    it('does not throw when tracing is disabled', async () => {
      const { initTracing, shutdownTracing } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      await expect(shutdownTracing()).resolves.not.toThrow();
    });
  });
});

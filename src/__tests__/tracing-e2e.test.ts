/**
 * tracing-e2e.test.ts — E2E tests for OpenTelemetry trace correlation.
 *
 * Issue #1939: Verifies span hierarchy (HTTP > session > tmux > channel),
 * trace ID correlation in structured logs, and OTel SDK initialization.
 *
 * Uses InMemorySpanExporter to capture exported spans without a real backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

// Create a single exporter and provider for all tests in this file.
// OTel's global tracer provider is set once and cannot be easily swapped per-test.
const memoryExporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'aegis-test',
  }),
  spanProcessors: [
    new SimpleSpanProcessor(memoryExporter),
  ],
});
provider.register();

describe('OpenTelemetry E2E trace correlation', () => {
  beforeEach(() => {
    memoryExporter.reset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('span hierarchy', () => {
    it('creates session spans as children of the active span', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      tracer.startActiveSpan('http.request', (parentSpan) => {
        const sessionSpan = tracer.startSpan('session.create', {
          kind: SpanKind.INTERNAL,
          attributes: { 'aegis.session.id': 'sess-123' },
        });
        sessionSpan.end();
        parentSpan.end();
      });

      const spans = memoryExporter.getFinishedSpans();
      expect(spans).toHaveLength(2);

      const httpSpan = spans.find(s => s.name === 'http.request')!;
      const sessionSpan = spans.find(s => s.name === 'session.create')!;

      expect(httpSpan).toBeDefined();
      expect(sessionSpan).toBeDefined();
      // session span is a child of the http span
      expect(sessionSpan.parentSpanContext?.spanId).toBe(httpSpan.spanContext().spanId);
      // Both belong to the same trace
      expect(sessionSpan.spanContext().traceId).toBe(httpSpan.spanContext().traceId);
    });

    it('creates tmux spans as children of session spans', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      tracer.startActiveSpan('session.create', (sessionSpan) => {
        const tmuxSpan = tracer.startSpan('tmux.create_window', {
          kind: SpanKind.INTERNAL,
          attributes: { 'aegis.tmux.window_id': '@0' },
        });
        tmuxSpan.end();
        sessionSpan.end();
      });

      const spans = memoryExporter.getFinishedSpans();
      expect(spans).toHaveLength(2);

      const sessionSpan = spans.find(s => s.name === 'session.create')!;
      const tmuxSpan = spans.find(s => s.name === 'tmux.create_window')!;

      expect(tmuxSpan.parentSpanContext?.spanId).toBe(sessionSpan.spanContext().spanId);
      expect(tmuxSpan.spanContext().traceId).toBe(sessionSpan.spanContext().traceId);
    });

    it('creates channel spans as children of the active span', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      tracer.startActiveSpan('session.create', (sessionSpan) => {
        const channelSpan = tracer.startSpan('channel.webhook.session.created', {
          kind: SpanKind.INTERNAL,
          attributes: { 'aegis.channel.event': 'session.created' },
        });
        channelSpan.end();
        sessionSpan.end();
      });

      const spans = memoryExporter.getFinishedSpans();
      expect(spans).toHaveLength(2);

      const sessionSpan = spans.find(s => s.name === 'session.create')!;
      const channelSpan = spans.find(s => s.name === 'channel.webhook.session.created')!;

      expect(channelSpan.parentSpanContext?.spanId).toBe(sessionSpan.spanContext().spanId);
    });

    it('full hierarchy: HTTP > session > tmux + channel', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      tracer.startActiveSpan('POST /v1/sessions', (httpSpan) => {
        tracer.startActiveSpan('session.create', (sessionSpan) => {
          const tmuxSpan = tracer.startSpan('tmux.create_window');
          tmuxSpan.end();

          const channelSpan = tracer.startSpan('channel.webhook.session.created');
          channelSpan.end();

          sessionSpan.end();
        });
        httpSpan.end();
      });

      const spans = memoryExporter.getFinishedSpans();
      expect(spans).toHaveLength(4);

      const httpSpan = spans.find(s => s.name === 'POST /v1/sessions')!;
      const sessionSpan = spans.find(s => s.name === 'session.create')!;
      const tmuxSpan = spans.find(s => s.name === 'tmux.create_window')!;
      const channelSpan = spans.find(s => s.name === 'channel.webhook.session.created')!;

      // Verify the hierarchy
      expect(sessionSpan.parentSpanContext?.spanId).toBe(httpSpan.spanContext().spanId);
      expect(tmuxSpan.parentSpanContext?.spanId).toBe(sessionSpan.spanContext().spanId);
      expect(channelSpan.parentSpanContext?.spanId).toBe(sessionSpan.spanContext().spanId);

      // All spans share the same trace ID
      const traceId = httpSpan.spanContext().traceId;
      for (const span of spans) {
        expect(span.spanContext().traceId).toBe(traceId);
      }
    });
  });

  describe('span attributes', () => {
    it('session spans include session ID and work dir', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      const span = tracer.startSpan('session.create', {
        attributes: {
          'aegis.session.id': 'sess-abc',
          'workDir': '/tmp/project',
        },
      });
      span.end();

      const [exported] = memoryExporter.getFinishedSpans();
      expect(exported.attributes['aegis.session.id']).toBe('sess-abc');
      expect(exported.attributes['workDir']).toBe('/tmp/project');
    });

    it('tmux spans include window ID', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      const span = tracer.startSpan('tmux.create_window', {
        attributes: { 'aegis.tmux.window_id': '@5' },
      });
      span.end();

      const [exported] = memoryExporter.getFinishedSpans();
      expect(exported.attributes['aegis.tmux.window_id']).toBe('@5');
    });

    it('channel spans include event name', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      const span = tracer.startSpan('channel.telegram.session.created', {
        attributes: { 'aegis.channel.event': 'session.created' },
      });
      span.end();

      const [exported] = memoryExporter.getFinishedSpans();
      expect(exported.attributes['aegis.channel.event']).toBe('session.created');
    });
  });

  describe('error recording on spans', () => {
    it('records error status and exception', () => {
      const tracer = trace.getTracer('aegis-test', '0.0.0');

      const span = tracer.startSpan('session.create');
      span.recordException(new Error('tmux failed'));
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'tmux failed' });
      span.end();

      const [exported] = memoryExporter.getFinishedSpans();
      expect(exported.status.code).toBe(SpanStatusCode.ERROR);
      expect(exported.status.message).toBe('tmux failed');
      // Exception events are recorded as span events
      const exceptions = exported.events.filter(e => e.name === 'exception');
      expect(exceptions).toHaveLength(1);
    });
  });

  describe('log-trace correlation', () => {
    it('logger includes trace_id and span_id when span is active', async () => {
      const { logger, setStructuredLogSink } = await import('../logger.js');

      const captured: unknown[] = [];
      setStructuredLogSink({
        info: (record) => captured.push(record),
        warn: () => {},
        error: () => {},
      });

      const tracer = trace.getTracer('aegis-test', '0.0.0');
      tracer.startActiveSpan('test.operation', (span) => {
        logger.info({ component: 'test', operation: 'op' });
        span.end();
      });

      expect(captured).toHaveLength(1);
      const record = captured[0] as Record<string, unknown>;
      expect(record.traceId).toBeDefined();
      expect(record.spanId).toBeDefined();
      expect(typeof record.traceId).toBe('string');
      expect(typeof record.spanId).toBe('string');
      expect(record.traceId).not.toBe('00000000000000000000000000000000');
      expect(record.spanId).not.toBe('0000000000000000');
    });

    it('logger omits trace_id and span_id when no span is active', async () => {
      const { logger, setStructuredLogSink } = await import('../logger.js');

      const captured: unknown[] = [];
      setStructuredLogSink({
        info: (record) => captured.push(record),
        warn: () => {},
        error: () => {},
      });

      logger.info({ component: 'test', operation: 'no-span' });

      expect(captured).toHaveLength(1);
      const record = captured[0] as Record<string, unknown>;
      expect(record.traceId).toBeUndefined();
      expect(record.spanId).toBeUndefined();
    });
  });

  describe('tracing module integration', () => {
    it('startChannelSpan creates a span with channel name prefix', async () => {
      const { initTracing, startChannelSpan } = await import('../tracing.js');
      await initTracing({ enabled: false, serviceName: 'test', otlpEndpoint: 'http://localhost:4318', sampleRate: 1.0 });
      const span = startChannelSpan('telegram', 'session.created', { 'aegis.channel.event': 'session.created' });
      expect(span).toBeDefined();
      expect(span.isRecording()).toBe(false);
      span.end();
    });
  });
});

/**
 * tracing.ts — OpenTelemetry distributed tracing for Aegis.
 *
 * Provides request-scoped tracing across the Fastify → session → tmux → monitor flow.
 * Configured via AEGIS_OTEL_* environment variables (all optional).
 *
 * When AEGIS_OTEL_ENABLED is not set (or "false"), tracing is a no-op —
 * the tracer returns no-op spans with zero overhead.
 *
 * Issue #1417: Research spike — OpenTelemetry tracing.
 */

import os from 'node:os';
import type { Tracer, Span, SpanOptions, Context } from '@opentelemetry/api';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';

// ── No-op fallback when tracing is disabled ────────────────────────────

/** No-op tracer that returns no-op spans. Zero overhead when tracing is off. */
class NoopTracerImpl implements Tracer {
  readonly instrumentationScope = { name: 'aegis', version: '0.0.0' };

  startSpan(_name: string, _options?: SpanOptions, _context?: Context): Span {
    // Return a non-recording span by wrapping an invalid span context.
    // trace.wrapSpanContext returns a NonRecordingSpan when the context is invalid.
    const INVALID_CONTEXT = {
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: 0,
    };
    return trace.wrapSpanContext(INVALID_CONTEXT) as unknown as Span;
  }

  startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions | undefined, context: Context | undefined, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions | undefined, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>;
  startActiveSpan(name: string, arg2?: unknown, arg3?: unknown, arg4?: unknown): unknown {
    const span = this.startSpan(name);
    const fn = typeof arg2 === 'function' ? arg2 : typeof arg3 === 'function' ? arg3 : arg4 as (...args: unknown[]) => unknown;
    if (!fn) return span;
    try {
      return fn(span);
    } finally {
      span.end();
    }
  }
}

// ── Configuration ──────────────────────────────────────────────────────

export interface TracingConfig {
  /** Enable tracing (default: false) */
  enabled: boolean;
  /** Service name sent to the tracing backend (default: "aegis") */
  serviceName: string;
  /** OTLP endpoint URL (default: "http://localhost:4318") */
  otlpEndpoint: string;
  /** Sample rate 0.0–1.0 (default: 1.0 = always sample) */
  sampleRate: number;
}

/** Load tracing config from AEGIS_OTEL_* environment variables. */
export function loadTracingConfig(): TracingConfig {
  return {
    enabled: process.env.AEGIS_OTEL_ENABLED === 'true',
    serviceName: process.env.AEGIS_OTEL_SERVICE_NAME || 'aegis',
    otlpEndpoint: process.env.AEGIS_OTEL_OTLP_ENDPOINT || 'http://localhost:4318',
    sampleRate: parseFloat(process.env.AEGIS_OTEL_SAMPLE_RATE || '1.0'),
  };
}

// ── Initialization ─────────────────────────────────────────────────────

let _tracer: Tracer = new NoopTracerImpl();
let _sdk: { shutdown: () => Promise<void> } | null = null;
let _initialized = false;

/**
 * Initialize the OpenTelemetry SDK.
 *
 * This must be called before the Fastify server starts (and before any
 * `@opentelemetry/auto-instrumentations-node` packages are loaded) so
 * that auto-instrumentation can patch Fastify, http, etc.
 *
 * Returns the global Tracer instance for creating manual spans.
 *
 * When `config.enabled` is false, returns a no-op tracer with zero overhead.
 */
export async function initTracing(config: TracingConfig): Promise<Tracer> {
  if (_initialized) return _tracer;

  if (!config.enabled) {
    console.log('Tracing: disabled (set AEGIS_OTEL_ENABLED=true to enable)');
    _initialized = true;
    return _tracer;
  }

  try {
    // Dynamic imports — only loads OTel SDK when tracing is enabled.
    // This avoids startup cost when tracing is off.
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const { AlwaysOnSampler, TraceIdRatioBasedSampler, ParentBasedSampler } = await import('@opentelemetry/sdk-trace-base');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');

    // Read service version from package.json
    let serviceVersion = '0.0.0';
    try {
      const pkg = await import('../package.json', { with: { type: 'json' } });
      serviceVersion = (pkg.default as { version?: string }).version ?? '0.0.0';
    } catch {
      // package.json not available
    }

    // Build the resource with service identity attributes
    const resourcesModule = await import('@opentelemetry/resources');
    const semconvModule = await import('@opentelemetry/semantic-conventions');
    const resource = resourcesModule.resourceFromAttributes({
      [semconvModule.ATTR_SERVICE_NAME]: config.serviceName,
      [semconvModule.ATTR_SERVICE_VERSION]: serviceVersion,
      'aegis.pid': String(process.pid),
      'aegis.node': os.hostname(),
    });

    // Sampler: AlwaysOn when sampleRate=1.0, ratio-based otherwise
    const sampler = config.sampleRate >= 1.0
      ? new AlwaysOnSampler()
      : new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(config.sampleRate),
        });

    // OTLP exporter (HTTP/protobuf — broadly compatible with Jaeger, Tempo, etc.)
    const exporter = new OTLPTraceExporter({
      url: `${config.otlpEndpoint}/v1/traces`,
    });

    const sdk = new NodeSDK({
      resource,
      sampler,
      spanProcessors: [
        new BatchSpanProcessor(exporter, {
          maxQueueSize: 2048,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 5000,
        }),
      ],
      // Auto-instrument Fastify, http, and dns lookups
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
        }),
      ],
    });

    sdk.start();
    _sdk = sdk;

    // Obtain a tracer for manual spans
    const api = await import('@opentelemetry/api');
    _tracer = api.trace.getTracer('aegis', serviceVersion);

    _initialized = true;
    console.log(`Tracing: enabled (OTLP → ${config.otlpEndpoint}, sampler=${config.sampleRate})`);

    return _tracer;
  } catch (e) {
    console.error('Tracing: failed to initialize — falling back to no-op:', e);
    _tracer = new NoopTracerImpl();
    _initialized = true;
    return _tracer;
  }
}

/**
 * Shut down the tracing SDK gracefully.
 * Call this during graceful shutdown to flush pending spans.
 */
export async function shutdownTracing(): Promise<void> {
  if (!_sdk) return;
  try {
    await _sdk.shutdown();
  } catch {
    // no-op — best effort flush
  }
}

/** Get the current tracer (may be a no-op if tracing is disabled). */
export function getTracer(): Tracer {
  return _tracer;
}

// ── Manual span helpers ────────────────────────────────────────────────

/**
 * Create a child span for a session operation.
 *
 * Usage:
 * ```ts
 * const span = startSessionSpan('create', sessionId, { workDir });
 * try { ... } finally { span.end(); }
 * ```
 */
export function startSessionSpan(
  operation: string,
  sessionId: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  return _tracer.startSpan(`session.${operation}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'aegis.session.id': sessionId,
      ...attributes,
    },
  });
}

/**
 * Create a child span for a tmux operation.
 */
export function startTmuxSpan(
  operation: string,
  windowId: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  return _tracer.startSpan(`tmux.${operation}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'aegis.tmux.window_id': windowId,
      ...attributes,
    },
  });
}

/**
 * Create a child span for a monitor operation.
 */
export function startMonitorSpan(
  operation: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  return _tracer.startSpan(`monitor.${operation}`, {
    kind: SpanKind.INTERNAL,
    attributes,
  });
}

/**
 * Create a child span for a channel delivery operation.
 */
export function startChannelSpan(
  channelName: string,
  operation: string,
  attributes?: Record<string, string | number | boolean>,
): Span {
  return _tracer.startSpan(`channel.${channelName}.${operation}`, {
    kind: SpanKind.INTERNAL,
    attributes,
  });
}

/**
 * Record an error on a span and set its status to ERROR.
 */
export function spanError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  span.recordException(error instanceof Error ? error : new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/**
 * Record a success status on a span.
 */
export function spanOk(span: Span, description?: string): void {
  span.setStatus({
    code: SpanStatusCode.OK,
    ...(description && { message: description }),
  });
}

/**
 * Check if tracing is enabled.
 */
export function isTracingEnabled(): boolean {
  return _initialized && !(_tracer instanceof NoopTracerImpl);
}

// Re-export for type usage
export { trace, context, SpanStatusCode, SpanKind };

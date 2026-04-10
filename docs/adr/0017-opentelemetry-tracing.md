# ADR-0017: OpenTelemetry Distributed Tracing

## Status
Accepted (research spike)

## Context

Aegis orchestrates Claude Code sessions through a multi-layered request flow:

```
Fastify HTTP → SessionManager → TmuxManager → SessionMonitor
```

When issues occur (stuck sessions, slow prompts, delivery failures), there is no
way to correlate events across these layers. Log entries are siloed by component,
making root-cause analysis difficult.

## Decision

Instrument Aegis with OpenTelemetry using `@opentelemetry/sdk-node` auto-instrumentation
for Fastify + HTTP, plus manual spans for the session/tmux/monitor cycle.

### Architecture

```
src/tracing.ts          ← New module: SDK setup, tracer, span helpers
src/server.ts           ← Initialize tracing before Fastify starts
src/config.ts           ← AEGIS_OTEL_* env vars (optional)
```

### Configuration

All tracing config is via environment variables (all optional):

| Variable | Default | Description |
|---|---|---|
| `AEGIS_OTEL_ENABLED` | `false` | Enable tracing |
| `AEGIS_OTEL_SERVICE_NAME` | `aegis` | Service name in traces |
| `AEGIS_OTEL_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP exporter endpoint |
| `AEGIS_OTEL_SAMPLE_RATE` | `1.0` | Head-based sampling ratio (0.0–1.0) |

### Span taxonomy

| Span name | Kind | Attributes |
|---|---|---|
| `session.create` | INTERNAL | `aegis.session.id`, `workDir` |
| `session.send` | INTERNAL | `aegis.session.id` |
| `session.kill` | INTERNAL | `aegis.session.id` |
| `tmux.send-keys` | INTERNAL | `aegis.tmux.window_id` |
| `tmux.capture-pane` | INTERNAL | `aegis.tmux.window_id` |
| `tmux.create-window` | INTERNAL | `aegis.tmux.window_id`, `workDir` |
| `monitor.poll` | INTERNAL | (none) |
| `monitor.stall_check` | INTERNAL | `stall_type` |
| HTTP spans | SERVER | Auto-instrumented by `@opentelemetry/instrumentation-fastify` |

### Exporter choice: OTLP over HTTP/protobuf

**Chosen:** `@opentelemetry/exporter-trace-otlp-http`

**Alternatives considered:**

| Exporter | Pros | Cons |
|---|---|---|
| **OTLP HTTP (chosen)** | Broad backend compatibility (Jaeger, Tempo, Honeycomb), no gRPC dependency | Slightly more overhead than gRPC |
| OTLP gRPC | Lower latency | Requires gRPC deps, proxy complexity |
| Jaeger exporter | Direct Jaeger support | Vendor-locked, deprecated in favor of OTLP |

### Sampling strategy

- **Default:** AlwaysOn (sample rate 1.0) — all traces are exported.
- **Production:** `ParentBasedSampler(TraceIdRatioBasedSampler(0.1))` — 10% of root spans,
  100% of child spans from sampled parents. This preserves request flows while reducing
  volume.
- Configured via `AEGIS_OTEL_SAMPLE_RATE`.

### Auto-instrumentation

`@opentelemetry/auto-instrumentations-node` provides automatic spans for:
- **Fastify** — all HTTP routes get `server.request` spans with route, method, status code.
- **HTTP** — outgoing HTTP client calls (if any).
- **Disabled:** `fs` and `dns` instrumentations (too noisy for Aegis's file-heavy workload).

### No-op when disabled

When `AEGIS_OTEL_ENABLED` is not set, `tracing.ts` returns a no-op tracer that creates
non-recording spans with zero allocation overhead. No OTel SDK code is loaded.

## Consequences

### Positive
- Request flows can be correlated end-to-end in a tracing backend (Jaeger, Grafana Tempo, etc.)
- Auto-instrumented Fastify spans require zero code changes for HTTP layer tracing
- Manual span helpers make it easy to instrument the session/tmux/monitor cycle
- No-op fallback means zero overhead when tracing is off

### Risks
- Additional dependency weight (~2MB for OTel SDK packages)
- Auto-instrumentation may add latency to hot paths (mitigated by no-op when disabled)
- OTLP exporter batches are lost if the process crashes before flush

### Future work
- Add manual spans to `session.ts`, `tmux.ts`, and `monitor.ts` (wiring only, no behavior change)
- Add span context propagation to webhook/SSE event payloads for cross-service correlation
- Evaluate `@opentelemetry/instrumentation-async-hooks` for better async context propagation

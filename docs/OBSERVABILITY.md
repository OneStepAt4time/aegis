# Observability Guide

Aegis exposes metrics, traces, and events that integrate with standard
observability stacks. This guide covers Prometheus, Grafana, Datadog, and
OpenTelemetry (OTLP).

---

## Overview

| Signal | Endpoint | Format | Auth |
|--------|----------|--------|------|
| Metrics | `GET /metrics` | Prometheus text exposition | `metricsToken` or `authToken` |
| Health | `GET /v1/health` | JSON | None (basic) / Bearer (detailed) |
| Events | `GET /v1/events` | SSE stream | Bearer |
| Traces | OTLP HTTP | Protobuf over HTTP | None (collector-side) |
| Alert stats | `GET /v1/alerts/stats` | JSON | Bearer (admin/operator/viewer) |
| Usage | `GET /v1/usage` | JSON | Bearer (admin/operator) |

---

## Prometheus Metrics

Aegis exposes a `/metrics` endpoint in standard Prometheus exposition format.
Scrape it from your Prometheus server:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: aegis
    scrape_interval: 15s
    scheme: http
    basic_auth:
      username: metrics
      password: ${AEGIS_METRICS_TOKEN}
    static_configs:
      - targets: ['localhost:9100']
```

### Available Metrics

**Counters:**

| Metric | Description |
|--------|-------------|
| `aegis_sessions_created_total` | Total sessions created |
| `aegis_sessions_completed_total` | Total sessions completed |
| `aegis_sessions_failed_total` | Total sessions that failed |
| `aegis_messages_total` | Total messages received |
| `aegis_tool_calls_total` | Total tool calls |
| `aegis_auto_approvals_total` | Total auto-approved permissions |
| `aegis_webhooks_sent_total` | Total webhooks sent |
| `aegis_webhooks_failed_total` | Total webhooks that failed |
| `aegis_screenshots_total` | Total screenshots taken |
| `aegis_pipelines_created_total` | Total pipelines created |
| `aegis_batches_created_total` | Total batch sessions created |
| `aegis_prompts_sent_total` | Total prompts sent |
| `aegis_prompts_delivered_total` | Total prompts delivered |
| `aegis_prompts_failed_total` | Total prompts that failed |

**Gauges:**

| Metric | Description |
|--------|-------------|
| `aegis_sessions_active` | Currently active sessions |

**Histograms** (buckets: 0.5ms to 10s):

| Metric | Description |
|--------|-------------|
| `aegis_hook_latency_ms` | Hook processing latency |
| `aegis_state_change_detection_latency_ms` | State change detection latency |
| `aegis_permission_response_latency_ms` | Permission response latency |
| `aegis_channel_delivery_latency_ms` | Channel delivery latency |

**Default Node.js metrics** (memory, CPU, event loop lag) are also exposed via
`prom-client`'s `collectDefaultMetrics`.

### Metrics Token

Set `AEGIS_METRICS_TOKEN` to require authentication on `/metrics`. If unset,
the primary `AEGIS_AUTH_TOKEN` is used.

---

## Grafana Integration

### Prerequisites

- Prometheus scraping Aegis `/metrics` (see above)
- Grafana connected to that Prometheus data source

### Quick Start

1. Import the bundled dashboards from `deploy/grafana/`:

```bash
# Each JSON file is a Grafana dashboard export.
# Import via: Dashboards → Import → Upload JSON file
ls deploy/grafana/
# aegis-costs.json  aegis-errors.json  aegis-sessions.json
```

| Dashboard | File | Panels |
|-----------|------|--------|
| Session Metrics | `aegis-sessions.json` | Active sessions, creation/completion rate, failure rate, avg duration |
| Cost & Usage | `aegis-costs.json` | Token usage by model, estimated cost, cost over time |
| Error Rates | `aegis-errors.json` | Session failure rate, webhook failures, prompt delivery failures |

### Example PromQL Queries

```promql
# Active sessions
aegis_sessions_active

# Session creation rate (per minute)
rate(aegis_sessions_created_total[5m]) * 60

# Session failure ratio
rate(aegis_sessions_failed_total[5m])
  / on() rate(aegis_sessions_created_total[5m])

# P99 permission response latency
histogram_quantile(0.99, rate(aegis_permission_response_latency_ms_bucket[5m]))

# Webhook success rate
rate(aegis_webhooks_sent_total[5m])
  - rate(aegis_webhooks_failed_total[5m])
```

---

## Datadog Integration

### Option A: Agent-based (Prometheus autodiscovery)

Datadog Agent can scrape Prometheus endpoints natively:

```yaml
# datadog-agent/conf.d/prometheus.d/conf.yaml
init_config:

instances:
  - prometheus_url: http://localhost:9100/metrics
    namespace: aegis
    metrics:
      - aegis_sessions_*:
          name: aegis.sessions
      - aegis_messages_total:
          name: aegis.messages
      - aegis_tool_calls_total:
          name: aegis.tool_calls
      - aegis_webhooks_*:
          name: aegis.webhooks
      - aegis_prompts_*:
          name: aegis.prompts
      - aegis_*_latency_ms:
          name: aegis.latency
    headers:
      Authorization: "Bearer ${AEGIS_METRICS_TOKEN}"
```

### Option B: StatsD/DogStatsD custom metrics

Use the Datadog Agent's StatsD listener with a small bridge script:

```bash
# Pipe Prometheus text output to datadog-metrics bridge
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:9100/metrics \
  | datadog-prometheus-bridge
```

### Dashboard and Monitors

Import the bundled configurations from `examples/datadog/`:

| File | Description |
|------|-------------|
| `aegis-dashboard.json` | Dashboard with session, cost, and error panels |
| `aegis-monitors.json` | Monitor definitions for session count, error rate, cost threshold |

---

## OpenTelemetry (OTLP) Tracing

Aegis emits distributed traces via OTLP HTTP when tracing is enabled.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_OTEL_ENABLED` | `false` | Enable tracing |
| `AEGIS_OTEL_SERVICE_NAME` | `aegis` | Service name in traces |
| `AEGIS_OTEL_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint |
| `AEGIS_OTEL_SAMPLE_RATE` | `1.0` | Sampling ratio (0.0–1.0) |

### Span Taxonomy

| Span | Kind | Key Attributes |
|------|------|----------------|
| `session.create` | INTERNAL | `aegis.session.id`, `workDir` |
| `session.send` | INTERNAL | `aegis.session.id` |
| `session.kill` | INTERNAL | `aegis.session.id` |
| `tmux.send-keys` | INTERNAL | `aegis.tmux.window_id` |
| `tmux.capture-pane` | INTERNAL | `aegis.tmux.window_id` |
| `tmux.create-window` | INTERNAL | `aegis.tmux.window_id`, `workDir` |
| `monitor.poll` | INTERNAL | — |
| `monitor.stall_check` | INTERNAL | `stall_type` |
| HTTP spans | SERVER | Auto-instrumented |

### Collector Configurations

A ready-to-use OTLP collector configuration is shipped in `deploy/otelcol/config.yaml`.
It supports Jaeger, Grafana Tempo, and Datadog exporters out of the box:

```bash
# Start the collector with the reference config
otelcol --config deploy/otelcol/config.yaml
```

See the file for backend-specific exporter configuration (Jaeger, Tempo, Datadog).

Additional per-backend examples are in `examples/otlp/`:

| File | Backend |
|------|---------|
| `collector-grafana.yaml` | Grafana Tempo via OTLP |
| `collector-jaeger.yaml` | Jaeger via OTLP |
| `collector-honeycomb.yaml` | Honeycomb via OTLP |

### Quick Start: Grafana Tempo

```bash
# 1. Start the collector
docker run -d --name otel-collector \
  -p 4318:4318 \
  -v ./examples/otlp/collector-grafana.yaml:/etc/otelcol/config.yaml \
  otel/opentelemetry-collector

# 2. Enable tracing in Aegis
AEGIS_OTEL_ENABLED=true \
AEGIS_OTEL_OTLP_ENDPOINT=http://localhost:4318 \
AEGIS_AUTH_TOKEN=my-secret \
ag
```

### Quick Start: Jaeger

```bash
# 1. Start Jaeger all-in-one
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/jaeger:latest

# 2. Enable tracing in Aegis
AEGIS_OTEL_ENABLED=true \
AEGIS_OTEL_OTLP_ENDPOINT=http://localhost:4318 \
AEGIS_AUTH_TOKEN=my-secret \
ag
```

---

## Alerting

See [ALERTING.md](./ALERTING.md) for recommended alert rules for session count,
error rates, and cost thresholds.

Aegis includes a built-in AlertManager that fires webhook notifications when
failure thresholds are exceeded. See [alerting.md](./alerting.md) for the
built-in alerting configuration.

### Prometheus Alert Rules

Pre-built Prometheus alerting rules are shipped in `deploy/prometheus/alerts.yml`:

```yaml
# prometheus.yml
rule_files:
  - deploy/prometheus/alerts.yml
```

| Alert | Severity | Description |
|-------|----------|-------------|
| `AegisDown` | critical | Server unresponsive for 2 minutes |
| `AegisHighSessionFailureRate` | warning | >10% sessions failing over 5 minutes |
| `AegisNoActiveSessions` | info | No sessions for 30 minutes |
| `AegisStaleSession` | warning | Sessions with no activity for 1 hour |
| `AegisWebhookFailureRate` | warning | >5% webhooks failing |
| `AegisPipelineStuck` | warning | Pipeline stuck for 10 minutes |
| `AegisHighPermissionLatency` | warning | P95 permission latency >30s |
| `AegisHighChannelDeliveryLatency` | warning | P95 channel delivery latency >10s |
| `AegisStateSyncDelay` | warning | P95 state detection latency >5s |

All alerts include `runbook_url` annotations linking to the relevant section
of the [Disaster Recovery Runbook](./DISASTER_RECOVERY.md).

---

## Health Checks

### Load Balancer (unauthenticated)

```bash
curl http://localhost:9100/v1/health
```

Returns:

```json
{ "status": "ok", "timestamp": "...", "sessions": { "active": 3 } }
```

Status values: `ok` | `degraded` | `draining`.

### Detailed (authenticated)

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/health
```

Adds `version`, `platform`, `uptime`, `tmux` health, and `claude` CLI health.

### Alert Stats

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/alerts/stats
```

Returns alert delivery counts and per-type failure tracking.

---

## Usage / Billing Integration

Aegis tracks per-session and per-key token usage with cost estimation:

```bash
# Total usage summary
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:9100/v1/usage?from=2026-04-01&to=2026-04-30"

# Per-key breakdown
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/usage/by-key

# Per-session usage
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/usage/sessions/abc-123
```

### Rate Tiers (default pricing per million tokens)

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| haiku | $0.80 | $4.00 | $1.00 | $0.08 |
| sonnet | $3.00 | $15.00 | $3.75 | $0.30 |
| opus | $15.00 | $75.00 | $18.75 | $1.50 |

---

## SSE Event Streams

For real-time observability, consume the SSE streams:

```bash
# All sessions
curl -N -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/events

# Specific session
curl -N -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/sessions/{id}/events
```

Global event types: `session_created`, `session_status_change`,
`session_message`, `session_approval`, `session_ended`, `session_stall`,
`session_dead`, `session_subagent_start`, `session_subagent_stop`,
`shutdown`.

---

## End-to-End Stack Example

```
Aegis (:9100)
  │
  ├─ /metrics ──────► Prometheus ──────► Grafana dashboards
  │                                        + alert rules
  │
  ├─ OTLP (:4318) ──► OTel Collector ──► Grafana Tempo / Jaeger
  │                                        (traces in Grafana)
  │
  ├─ /v1/events ────► SSE consumer ────► Custom dashboards / paging
  │
  └─ /v1/usage ─────► Billing system / cost dashboards
```

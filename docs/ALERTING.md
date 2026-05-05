# Alerting Recommendations

Recommended alert rules for Aegis deployments. These complement the built-in
AlertManager (see [alerting.md](./alerting.md)) with metrics-based alerts for
Prometheus, Datadog, or any observability platform scraping the `/metrics`
endpoint.

---

## Alert Summary

| # | Alert | Severity | Metric | Threshold |
|---|-------|----------|--------|-----------|
| 1 | HighSessionCount | warning | `aegis_sessions_active` | > 50 |
| 2 | CriticalSessionCount | critical | `aegis_sessions_active` | > 100 |
| 3 | SessionFailureRateSpike | critical | `aegis_sessions_failed_total / aegis_sessions_created_total` | > 20% over 15m |
| 4 | SessionFailureRateWarning | warning | same | > 10% over 15m |
| 5 | WebhookDeliveryFailures | warning | `aegis_webhooks_failed_total` | > 10 in 10m |
| 6 | PromptDeliveryFailures | warning | `aegis_prompts_failed_total` | > 5 in 10m |
| 7 | PermissionLatencyHigh | warning | `aegis_permission_response_latency_ms` p99 | > 5s |
| 8 | PermissionLatencyCritical | critical | same | > 10s |
| 9 | DailyCostThreshold | warning | `/v1/usage` cost | > $50/day |
| 10 | DailyCostCritical | critical | same | > $100/day |
| 11 | HealthDegraded | critical | `/v1/health` status | status ≠ "ok" |

---

## Prometheus Alert Rules

Save to your Alertmanager rules file (e.g., `aegis-alerts.yml`):

```yaml
groups:
  - name: aegis.sessions
    rules:
      - alert: AegisHighSessionCount
        expr: aegis_sessions_active > 50
        for: 5m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Aegis has {{ $value }} active sessions"
          runbook: "Check for runaway sessions. Consider scaling or enabling session limits."

      - alert: AegisCriticalSessionCount
        expr: aegis_sessions_active > 100
        for: 2m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Aegis session count is critical: {{ $value }}"
          runbook: "Immediate action needed. Kill stale sessions or scale the deployment."

      - alert: AegisSessionFailureRateSpike
        expr: >
          rate(aegis_sessions_failed_total[15m])
            / on()
          rate(aegis_sessions_created_total[15m])
            > 0.2
        for: 5m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Aegis session failure rate is {{ $value | humanizePercentage }}"
          runbook: "Check Claude CLI health (`/v1/health`), tmux status, and recent deployments."

      - alert: AegisSessionFailureRateWarning
        expr: >
          rate(aegis_sessions_failed_total[15m])
            / on()
          rate(aegis_sessions_created_total[15m])
            > 0.1
        for: 10m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Aegis session failure rate is elevated: {{ $value | humanizePercentage }}"

  - name: aegis.webhooks
    rules:
      - alert: AegisWebhookDeliveryFailures
        expr: increase(aegis_webhooks_failed_total[10m]) > 10
        for: 2m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "{{ $value }} webhook delivery failures in 10 minutes"
          runbook: "Check webhook endpoint health and network connectivity."

  - name: aegis.prompts
    rules:
      - alert: AegisPromptDeliveryFailures
        expr: increase(aegis_prompts_failed_total[10m]) > 5
        for: 2m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "{{ $value }} prompt delivery failures in 10 minutes"
          runbook: "Check channel health via /v1/channels/health."

  - name: aegis.latency
    rules:
      - alert: AegisPermissionLatencyHigh
        expr: >
          histogram_quantile(0.99, rate(aegis_permission_response_latency_ms_bucket[15m]))
            > 5000
        for: 5m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Aegis permission response p99 latency is {{ $value }}ms"
          runbook: "Sessions may be stalling. Check approval workflow responsiveness."

      - alert: AegisPermissionLatencyCritical
        expr: >
          histogram_quantile(0.99, rate(aegis_permission_response_latency_ms_bucket[15m]))
            > 10000
        for: 3m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Aegis permission response p99 latency is critical: {{ $value }}ms"
          runbook: "Sessions are likely timing out. Check approval handlers immediately."
```

---

## Cost Alerts

Aegis tracks cost via the `/v1/usage` API rather than Prometheus counters. Use
one of these approaches:

### Option A: Cron + curl

```bash
#!/bin/bash
# Run daily via cron. Posts to a webhook if cost exceeds threshold.
FROM=$(date -d 'yesterday' +%Y-%m-%d)
TO=$(date +%Y-%m-%d)
TOKEN="${AEGIS_AUTH_TOKEN}"
THRESHOLD=100

COST=$(curl -sf -H "Authorization: Bearer $TOKEN" \
  "http://localhost:9100/v1/usage?from=${FROM}&to=${TO}" \
  | jq -r '.totalCostUsd')

if (( $(echo "$COST > $THRESHOLD" | bc -l) )); then
  curl -sf -X POST "${ALERT_WEBHOOK}" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"Aegis daily cost alert: \$${COST} (threshold: \$${THRESHOLD})\"}"
fi
```

### Option B: Datadog monitor

Import from `examples/datadog/aegis-monitors.json` or create manually using the
cost metric bridge described in [OBSERVABILITY.md](./OBSERVABILITY.md).

---

## Health Check Alerting

### HTTP-based

```bash
# Simple health check with alert on non-OK status
STATUS=$(curl -sf http://localhost:9100/v1/health | jq -r '.status')
if [ "$STATUS" != "ok" ]; then
  echo "Aegis health is: $STATUS" >&2
  # Trigger alert
fi
```

### Prometheus blackbox exporter

```yaml
# blackbox.yml
modules:
  http_aegis_health:
    prober: http
    timeout: 5s
    http:
      valid_status_codes: [200]
      fail_if_body_not_matches_regexp:
        - '"status":"ok"'
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: aegis_health
    metrics_path: /probe
    params:
      module: [http_aegis_health]
    static_configs:
      - targets:
          - http://localhost:9100/v1/health
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115
```

---

## Alerting Best Practices

1. **Start with session failures and health checks.** These are the highest-signal
   alerts for Aegis.

2. **Tune thresholds to your deployment.** The defaults above assume a
   small-to-medium deployment (10–100 concurrent sessions). Adjust based on
   your baseline.

3. **Use the built-in AlertManager for webhook delivery.** Aegis can push
   alerts directly to Slack, PagerDuty, etc. via `AEGIS_ALERT_WEBHOOKS`.
   Metrics-based alerts are complementary.

4. **Set cooldown periods.** Aegis's built-in alerts use a 10-minute cooldown
   by default (`AEGIS_ALERT_COOLDOWN_MS`). Apply similar cooldowns in your
   observability platform to prevent alert fatigue.

5. **Correlate with traces.** When a latency alert fires, use the OTLP traces
   (see [OBSERVABILITY.md](./OBSERVABILITY.md)) to identify which session or
   tmux operation is slow.

6. **Monitor cost daily.** Token costs can accumulate quickly with high session
   counts. Set up daily cost checks using the `/v1/usage` API.

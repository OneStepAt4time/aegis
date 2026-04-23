# Load Test — Concurrent Session Capacity (Issue #2093)

Measures Aegis API throughput and latency under concurrent load.

## Prerequisites

- Aegis server running (`npm run dev` or `npm start`)
- [tsx](https://github.com/privatenumber/tsx) for running TypeScript directly (`npx tsx` works without install)

## Quick Start

```bash
# Start Aegis in one terminal
npm run dev

# Run load test with defaults (10 concurrent sessions)
npx tsx scripts/load-test.ts

# Run at specific concurrency level
npx tsx scripts/load-test.ts --concurrency 50

# Run multiple levels sequentially
npx tsx scripts/load-test.ts --levels 10,50,100

# JSON output (pipe to file or jq)
npx tsx scripts/load-test.ts --levels 10,50,100 --json
```

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--url <url>` | `http://127.0.0.1:9100` | Aegis base URL (or set `AEGIS_BASE_URL`) |
| `--token <str>` | empty | Auth bearer token (or set `AEGIS_AUTH_TOKEN`) |
| `--concurrency <n>` | `10` | Number of concurrent sessions |
| `--levels <n,n,...>` | — | Run multiple levels (overrides `--concurrency`) |
| `--messages <n>` | `1` | Messages to send per session |
| `--work-dir <dir>` | `/tmp/aegis-load-test` | Working directory for sessions |
| `--json` | off | Output raw JSON (suppresses table) |
| `--no-cleanup` | off | Skip session deletion after test |

## What It Measures

For each concurrency level:

1. **Session creation** — `POST /v1/sessions` fired N times concurrently
2. **Message round-trip** — `POST /v1/sessions/:id/send` to each created session
3. **Cleanup** — `DELETE /v1/sessions/:id` for all created sessions

Metrics per level:

| Metric | Description |
|--------|-------------|
| `sessionsPerSec` | Successful session creations per second |
| `messagesPerSec` | Successful message sends per second |
| `overallErrorRate` | Fraction of total operations that failed |
| Latency percentiles | min, p50, p95, p99, max, avg for creates and messages |

## Example Output

```
Aegis load test — http://127.0.0.1:9100
Levels: 10, 50, 100 | Messages/session: 1 | Work dir: /tmp/aegis-load-test

--- Concurrency 10 ---
  Creating 10 sessions ...
  Created 10/10 in 120ms (83.3/s)
  Sending 1 message(s) to each of 10 sessions ...
  Sent 10/10 in 45ms (222.2/s)
  Cleaning up 10 sessions ...
  Cleaned 10, failed 0

--- Concurrency 50 ---
  ...

┌──────────────────────────────────────────────────────────────────────────────┐
│                        Load Test Results                                     │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│ Concur.  │ Created  │ Ses/sec  │ Msg/sec  │ Err Rate │ Ses p95  │ Msg p95  │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ 10       │ 10/10    │ 83.3     │ 222.2    │ 0.0%     │ 15.2ms   │ 5.1ms    │
│ 50       │ 50/50    │ 75.1     │ 198.4    │ 0.0%     │ 22.8ms   │ 7.3ms    │
│ 100      │ 98/100   │ 62.3     │ 170.1    │ 1.0%     │ 45.6ms   │ 12.4ms   │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

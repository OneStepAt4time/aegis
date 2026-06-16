# Mock SSE Producer Rig (#4740)

The mock SSE producer rig drives synthetic SSE push events directly into
the dashboard's `window.__aegisPerf__` test hook, bypassing the live CC
session entirely. It exists to validate the dashboard's SSE-push stress
surface (CLS, heap, page-load) without depending on a live Claude Code
session — which has been the failure mode for the Phase 2 #4683 retry
(P0 #4737/#4738 ACK round-trip defects drop the worker to `pending`,
the SSE push stream dries up, and the test measures the wrong thing).

## Why a mock producer?

The existing driver scripts (`driver-phase2.mjs`, `driver-phase2b.mjs`,
`driver-final.mjs`) all rely on a live CC session for SSE pushes. Run 2
of the previous Phase 2 attempt saw 3 pushes in 90 seconds, then 0 for
the rest of the 26-minute run (worker `pending`, `byteOffset=0`). That's
not enough signal to validate the regression surface.

The mock producer:
- injects 1 push/sec (configurable via `PUSH_HZ`) for 30 minutes
  (configurable via `RUN_DURATION_MS`)
- uses a randomized render time per push (default 20-150ms)
- bypasses CC and the live SSE stream entirely
- updates the perfRecorder naturally — all downstream metrics
  (`ssePushToRenderCount`, p50/p95/max, `recentPageLoads`) reflect
  the synthetic pushes

## Usage

```sh
# Local dev (assumes AEGIS running on :9100, token in env)
AEGIS_TOKEN=... node scripts/perf/mock-sse-producer.mjs

# Default 30-min run, 1 Hz push rate
AEGIS_TOKEN=... node scripts/perf/mock-sse-producer.mjs

# Quick smoke (60s, 5 Hz)
AEGIS_TOKEN=... PUSH_HZ=5 RUN_DURATION_MS=60000 node scripts/perf/mock-sse-producer.mjs
```

## Env vars

| Var | Default | Description |
| --- | --- | --- |
| `AEGIS_TOKEN` | (required) | Bearer token for `/v1/auth/verify` |
| `AEGIS_BASE` | `http://127.0.0.1:9100` | Aegis server base URL |
| `PUSH_HZ` | `1` | Pushes per second |
| `RUN_DURATION_MS` | `1800000` (30 min) | Total run duration |
| `TICK_MS` | `30000` (30 sec) | Snapshot/log cadence |
| `RENDER_MIN_MS` | `20` | Lower bound of synthetic render time |
| `RENDER_MAX_MS` | `150` | Upper bound of synthetic render time |
| `OUT_DIR` | `/home/bubuntu/.aegis-perf-run` | Output directory |

## Output

- `${OUT_DIR}/mock-producer.log` — JSONL log of snapshots + lifecycle events
- `${OUT_DIR}/mock-producer.stdout` — mirror of stdout (redirect via shell: `> ${OUT_DIR}/mock-producer.stdout`)
- `${OUT_DIR}/mock-producer.pid` — PID file (for clean shutdown)

## Acceptance criteria for the next Phase 2 retry (#4740)

The rig is fit-for-purpose when:

- [ ] `ssePushToRenderCount >= 100` sustained over a 30-min window
- [ ] CLS p100 < 0.5 across that window (or root-cause the spike with a candidate fix — see #4739)
- [ ] Heap p95 < 12MB across that window
- [ ] Page load p95 < 2s across that window
- [ ] Zero SSE reconnects, zero give-ups
- [ ] Zero new P0s/P1s

The mock producer's job is to drive `ssePushToRenderCount` reliably.
The other metrics (CLS, heap, page load) are dashboard-side concerns
that the existing tests already cover. Run the existing
`driver-final.mjs` in parallel to capture the dashboard-side metrics
under the synthetic load.

## Test-only hook

The `_testInjectSsePush(ms)` method on `window.__aegisPerf__` is
test-only. The underscore prefix flags it as not-for-production-use;
production code should call the regular SSE pipeline. The method
delegates to `perfRecorder.recordSsePushToRender(ms)` and updates
all derived metrics naturally.

## Related issues

- #4740 — parent: Phase 2 test-rig limitation
- #4683 — parent: Endurance test 4h+ CC development session through Aegis
- #4737 — [P0] prompt_ack_timeout (CC ACK round-trip)
- #4738 — P0 ag send `no_acp_runtime` (CC runtime registration race)
- #4739 — [Endurance #4683 Phase 2] CLS tail breaches 0.5 under SSE-push stress

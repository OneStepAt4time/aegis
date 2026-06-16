/**
 * mock-sse-producer.mjs — Synthetic SSE push producer for the #4683 Phase 2 retry.
 *
 * Why this exists:
 *   The existing driver-phase2 rig relies on a live CC session to drive SSE
 *   pushes. The CC session drops to `pending` (P0 #4737/#4738 ACK round-trip
 *   defects), so the SSE push stream dries up after a few seconds and the
 *   test measures the wrong thing (at-rest perf, not SSE-push stress).
 *
 *   This rig bypasses CC entirely. It injects synthetic SSE push events
 *   directly into the dashboard's `window.__aegisPerf__` via the
 *   `_testInjectSsePush` test hook, so the perfRecorder state and all
 *   downstream metrics (p50/p95/max of push→render time) update naturally.
 *
 * What it does:
 *   1. Launches headless Chromium (Playwright) and navigates to the dashboard.
 *   2. Authenticates via /v1/auth/verify (Bearer token from AEGIS_TOKEN env).
 *   3. Resets the perfRecorder (clean baseline).
 *   4. On a fixed cadence (default 1 Hz), injects an SSE push event with a
 *      randomized render time (uniform in [RENDER_MIN_MS, RENDER_MAX_MS]).
 *   5. Periodically (every TICK_MS) logs the snapshot to the JSONL output.
 *   6. After RUN_DURATION_MS, writes a summary to stdout + the log file.
 *
 * Acceptance criteria (from #4740):
 *   - ssePushToRenderCount >= 100 sustained over a 30-min window
 *   - Heap p95 < 12MB, page load p95 < 2s (dashboard-side; not driven by this rig)
 *   - Zero SSE reconnects, zero give-ups
 *
 * Usage:
 *   AEGIS_TOKEN=... node scripts/perf/mock-sse-producer.mjs
 *
 * Env vars:
 *   AEGIS_TOKEN      (required) Bearer token for /v1/auth/verify
 *   AEGIS_BASE       (default: http://127.0.0.1:9100)
 *   PUSH_HZ          (default: 1) pushes per second
 *   RUN_DURATION_MS  (default: 1800000 = 30 min)
 *   TICK_MS          (default: 30000 = 30 sec) snapshot/log cadence
 *   RENDER_MIN_MS    (default: 20) lower bound of synthetic render time
 *   RENDER_MAX_MS    (default: 150) upper bound of synthetic render time
 *   OUT_DIR          (default: /home/bubuntu/.aegis-perf-run)
 *
 * Output:
 *   ${OUT_DIR}/mock-producer.log    — JSONL log of snapshots and lifecycle events
 *   ${OUT_DIR}/mock-producer.stdout — mirror of stdout (redirect via shell: `> ${OUT_DIR}/mock-producer.stdout`)
 *   ${OUT_DIR}/mock-producer.pid    — PID file (for clean shutdown)
 */

import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// Config ----------------------------------------------------------------

const AEGIS_BASE = process.env.AEGIS_BASE || 'http://127.0.0.1:9100';
const DASH_URL = `${AEGIS_BASE}/dashboard/?perf=1`;
const PUSH_HZ = Number(process.env.PUSH_HZ || 1);
const RUN_DURATION_MS = Number(process.env.RUN_DURATION_MS || 30 * 60 * 1000);
const TICK_MS = Number(process.env.TICK_MS || 30_000);
const RENDER_MIN_MS = Number(process.env.RENDER_MIN_MS || 20);
const RENDER_MAX_MS = Number(process.env.RENDER_MAX_MS || 150);
const OUT_DIR = process.env.OUT_DIR || '/home/bubuntu/.aegis-perf-run';
const TOKEN = process.env.AEGIS_TOKEN;

if (!TOKEN) {
  console.error('AEGIS_TOKEN env var required');
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/mock-producer.pid`, String(process.pid));

const LOG_FILE = `${OUT_DIR}/mock-producer.log`;

const PUSH_INTERVAL_MS = Math.max(1, Math.floor(1000 / PUSH_HZ));
const startedAt = Date.now();
const startedIso = new Date(startedAt).toISOString();

function log(level, msg, extra) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra || {}) });
  appendFileSync(LOG_FILE, line + '\n');
  process.stdout.write(line + '\n');
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

log('info', 'mock SSE producer start', {
  startedIso,
  aegisBase: AEGIS_BASE,
  pushHz: PUSH_HZ,
  pushIntervalMs: PUSH_INTERVAL_MS,
  runDurationMs: RUN_DURATION_MS,
  tickMs: TICK_MS,
  renderMinMs: RENDER_MIN_MS,
  renderMaxMs: RENDER_MAX_MS,
  outDir: OUT_DIR,
});

// Browser setup ---------------------------------------------------------

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  baseURL: AEGIS_BASE,
});
const page = await context.newPage();

page.on('pageerror', (err) => log('error', 'page error', { message: err.message }));
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const text = msg.text();
    if (!text.includes('429')) log('warn', 'console error', { text });
  }
});
page.on('response', (resp) => {
  if (resp.status() >= 500) log('warn', '5xx', { url: resp.url(), status: resp.status() });
});

// Auth + navigate -------------------------------------------------------

log('info', 'preload origin + skip onboarding');
await page.addInitScript(() => {
  try { localStorage.setItem('aegis:onboarded', '1'); } catch {}
  try { localStorage.setItem('aegis:tour:completed', '1'); } catch {}
});

try {
  await page.goto(`${AEGIS_BASE}/dashboard/login`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
} catch (e) {
  log('warn', 'preload goto failed', { message: e.message });
}

log('info', 'posting auth/verify');
const verify = await page.evaluate(
  async ({ token, base }) => {
    const r = await fetch(`${base}/v1/auth/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return { ok: r.ok, status: r.status };
  },
  { token: TOKEN, base: AEGIS_BASE }
);
log('info', 'auth/verify', { ok: verify.ok, status: verify.status });
if (!verify.ok) {
  log('error', 'auth failed');
  await browser.close();
  process.exit(3);
}

log('info', 'opening dashboard');
await page.goto(DASH_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
// Give perfRecorder a tick to install on window.
await page.waitForFunction(() => typeof window.__aegisPerf__ !== 'undefined', { timeout: 5_000 });

// Reset baseline.
await page.evaluate(() => window.__aegisPerf__.reset());
log('info', 'baseline reset; starting push loop');

// Push loop -------------------------------------------------------------

const stops = { push: false, tick: false };
let lastTickAt = Date.now();

async function pushTick() {
  while (!stops.push) {
    const renderMs = randInt(RENDER_MIN_MS, RENDER_MAX_MS);
    try {
      await page.evaluate((ms) => window.__aegisPerf__._testInjectSsePush(ms), renderMs);
    } catch (e) {
      log('error', 'push injection failed', { message: e.message });
      stops.push = true;
      break;
    }
    await sleep(PUSH_INTERVAL_MS);
  }
}

async function tickLog() {
  while (!stops.tick) {
    await sleep(TICK_MS);
    try {
      const snap = await page.evaluate(() => window.__aegisPerf__.snapshot());
      const elapsed = Date.now() - startedAt;
      log('info', 'tick', {
        elapsedMs: elapsed,
        ssePushCount: snap?.sessionList?.ssePushToRenderCount ?? null,
        ssePushP50Ms: snap?.sessionList?.ssePushToRenderP50Ms ?? null,
        ssePushP95Ms: snap?.sessionList?.ssePushToRenderP95Ms ?? null,
        ssePushMaxMs: snap?.sessionList?.ssePushToRenderMaxMs ?? null,
        heapUsedMb: snap?.memory?.usedJsHeapMb ?? null,
        sseOpenCount: snap?.sse?.length ?? null,
      });
      lastTickAt = Date.now();
    } catch (e) {
      log('error', 'tick snapshot failed', { message: e.message });
      stops.tick = true;
      break;
    }
  }
}

const pushPromise = pushTick();
const tickPromise = tickLog();

// Watchdog: if tick loop hasn't logged in 3x TICK_MS, bail.
const watchdog = setInterval(() => {
  if (Date.now() - lastTickAt > 3 * TICK_MS) {
    log('error', 'watchdog: tick loop silent for too long; bailing');
    stops.push = true;
    stops.tick = true;
  }
}, TICK_MS);

// Run until duration elapses.
await sleep(RUN_DURATION_MS);
stops.push = true;
stops.tick = true;
clearInterval(watchdog);

await Promise.allSettled([pushPromise, tickPromise]);

// Summary ---------------------------------------------------------------

let summary = null;
try {
  summary = await page.evaluate(() => window.__aegisPerf__.snapshot());
} catch (e) {
  log('error', 'final snapshot failed', { message: e.message });
}

log('info', 'run complete', {
  durationMs: Date.now() - startedAt,
  finalPushCount: summary?.sessionList?.ssePushToRenderCount ?? null,
  finalP50Ms: summary?.sessionList?.ssePushToRenderP50Ms ?? null,
  finalP95Ms: summary?.sessionList?.ssePushToRenderP95Ms ?? null,
  finalMaxMs: summary?.sessionList?.ssePushToRenderMaxMs ?? null,
  finalHeapMb: summary?.memory?.usedJsHeapMb ?? null,
  sseOpenCount: summary?.sse?.length ?? null,
});

await browser.close();
process.exit(0);

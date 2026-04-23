#!/usr/bin/env node

/**
 * Aegis Load Test — Issue #2093
 *
 * Concurrent session creation and message delivery benchmark against a
 * running Aegis server.
 *
 * Usage:
 *   AEGIS_AUTH_TOKEN=mytoken node scripts/load-test.mjs
 *
 * Environment variables:
 *   AEGIS_LOAD_TEST_URL      Base URL (default: http://127.0.0.1:9100)
 *   AEGIS_AUTH_TOKEN          Bearer token for auth
 *   AEGIS_LOAD_TEST_WORKDIR  Working directory for sessions (default: /tmp/aegis-load-test)
 *   AEGIS_LOAD_TEST_LEVELS   Comma-separated concurrency levels (default: 10,50,100,500)
 *   AEGIS_LOAD_TEST_OUTPUT   JSON output file path (default: load-test-results.json)
 *   AEGIS_LOAD_TEST_MESSAGE  Message text to send (default: "load-test-ping")
 */

import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// ── Configuration ──────────────────────────────────────────────────────

const BASE_URL = process.env.AEGIS_LOAD_TEST_URL || 'http://127.0.0.1:9100';
const AUTH_TOKEN = process.env.AEGIS_AUTH_TOKEN || '';
const WORK_DIR =
  process.env.AEGIS_LOAD_TEST_WORKDIR || path.join(os.tmpdir(), 'aegis-load-test');
const LEVELS = (process.env.AEGIS_LOAD_TEST_LEVELS || '10,50,100,500')
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => n > 0);
const OUTPUT_FILE =
  process.env.AEGIS_LOAD_TEST_OUTPUT || 'load-test-results.json';
const MESSAGE_TEXT = process.env.AEGIS_LOAD_TEST_MESSAGE || 'load-test-ping';

// ── HTTP helpers ───────────────────────────────────────────────────────

function requestHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

/**
 * Create one session via POST /v1/sessions.
 * Returns timing + outcome (never throws).
 */
async function createSession(index, level) {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify({
        workDir: WORK_DIR,
        name: `load-L${level}-${index}`,
      }),
    });
    const elapsed = performance.now() - start;
    const body = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs: elapsed,
      sessionId: body?.id ?? null,
      error: res.ok ? null : (body?.error ?? body),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      elapsedMs: performance.now() - start,
      sessionId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send a message via POST /v1/sessions/:id/send.
 * Returns timing + delivery status (never throws).
 */
async function sendMessage(sessionId) {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/v1/sessions/${sessionId}/send`, {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify({ text: MESSAGE_TEXT }),
    });
    const elapsed = performance.now() - start;
    const body = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs: elapsed,
      delivered: body?.delivered ?? false,
      error: res.ok ? null : (body?.error ?? body),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      elapsedMs: performance.now() - start,
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Best-effort session cleanup. */
async function deleteSession(sessionId) {
  try {
    await fetch(`${BASE_URL}/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: requestHeaders(),
    });
  } catch {
    // intentional best-effort
  }
}

// ── Statistics ─────────────────────────────────────────────────────────

function computeStats(values) {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const pct = (p) => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
  return {
    min: Math.round(sorted[0]),
    max: Math.round(sorted[sorted.length - 1]),
    mean: Math.round(sum / sorted.length),
    p50: Math.round(pct(0.5)),
    p95: Math.round(pct(0.95)),
    p99: Math.round(pct(0.99)),
  };
}

// ── Run one concurrency level ──────────────────────────────────────────

async function runLevel(level) {
  console.log(`\n── Level ${level} ──`);

  // Phase 1: Concurrent session creation
  const wallStart = performance.now();
  const creationResults = await Promise.all(
    Array.from({ length: level }, (_, i) => createSession(i, level)),
  );
  const wallTimeMs = performance.now() - wallStart;

  const created = creationResults.filter((r) => r.ok);
  const failed = creationResults.filter((r) => !r.ok);
  const sessionIds = created.map((r) => r.sessionId).filter(Boolean);

  const errorsByStatus = {};
  for (const f of failed) {
    const key = f.status === 0 ? 'network' : String(f.status);
    errorsByStatus[key] = (errorsByStatus[key] || 0) + 1;
  }

  console.log(
    `  Sessions: ${created.length}/${level} created (${wallTimeMs.toFixed(0)}ms wall)`,
  );
  if (failed.length > 0) {
    console.log(`  Errors:   ${JSON.stringify(errorsByStatus)}`);
  }

  // Phase 2: Message delivery (only on successful sessions)
  let messageResults = [];
  if (sessionIds.length > 0) {
    const msgStart = performance.now();
    messageResults = await Promise.all(
      sessionIds.map((id) => sendMessage(id)),
    );
    const msgWall = performance.now() - msgStart;

    const msgOk = messageResults.filter((r) => r.ok);
    const msgDelivered = messageResults.filter((r) => r.delivered);
    console.log(
      `  Messages: ${msgDelivered.length}/${sessionIds.length} delivered (${msgWall.toFixed(0)}ms wall)`,
    );

    if (msgOk.length > 0) {
      const s = computeStats(msgOk.map((r) => r.elapsedMs));
      console.log(
        `  Msg lat:  p50=${s.p50}ms  p95=${s.p95}ms  p99=${s.p99}ms`,
      );
    }
  }

  // Phase 3: Cleanup
  await Promise.all(sessionIds.map((id) => deleteSession(id)));

  return {
    level,
    wallTimeMs: Math.round(wallTimeMs),
    sessions: {
      total: level,
      created: created.length,
      failed: failed.length,
      errorRate: Number(((failed.length / level) * 100).toFixed(1)),
      errorsByStatus,
      latencyMs: computeStats(created.map((r) => r.elapsedMs)),
    },
    messages: {
      attempted: sessionIds.length,
      delivered: messageResults.filter((r) => r.delivered).length,
      failed: messageResults.filter((r) => !r.ok).length,
      latencyMs: computeStats(
        messageResults.filter((r) => r.ok).map((r) => r.elapsedMs),
      ),
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('Aegis Load Test — Issue #2093');
  console.log(`Target:  ${BASE_URL}`);
  console.log(`Levels:  [${LEVELS.join(', ')}]`);
  console.log(`WorkDir: ${WORK_DIR}`);
  console.log(`Output:  ${OUTPUT_FILE}`);

  // Ensure workDir exists
  await mkdir(WORK_DIR, { recursive: true });

  // Health check
  let healthy = false;
  try {
    const res = await fetch(`${BASE_URL}/v1/health`, { headers: requestHeaders() });
    if (res.ok) {
      const body = await res.json();
      healthy = body.status === 'ok' || body.status === 'degraded';
    }
  } catch {
    // intentional — report below
  }
  if (!healthy) {
    console.error(`\nERROR: Aegis not healthy at ${BASE_URL}/v1/health`);
    console.error('Start the server first: npm start');
    process.exit(1);
  }
  console.log('Health:  ok');

  // Run each level sequentially
  const levelResults = [];
  for (const level of LEVELS) {
    const result = await runLevel(level);
    levelResults.push(result);
  }

  // Write JSON results
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    workDir: WORK_DIR,
    levels: levelResults,
  };
  await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\nResults: ${OUTPUT_FILE}`);

  // Summary table
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(' Level | Created | Error% | Wall ms | Creation p50/p95 | Msg p50/p95 ');
  console.log('───────|─────────|────────|─────────|──────────────────|─────────────');
  for (const r of levelResults) {
    const s = r.sessions;
    const m = r.messages;
    const created = `${s.created}/${s.total}`;
    const creationLat = `${s.latencyMs.p50}/${s.latencyMs.p95}`;
    const msgLat = m.attempted > 0 ? `${m.latencyMs.p50}/${m.latencyMs.p95}` : 'n/a';
    console.log(
      ` ${String(r.level).padStart(5)} | ${created.padEnd(7)} | ${String(s.errorRate).padStart(5)}% | ${String(r.wallTimeMs).padStart(7)} | ${creationLat.padEnd(16)} | ${msgLat}`,
    );
  }
  console.log('═══════════════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

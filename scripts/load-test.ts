#!/usr/bin/env node
/**
 * scripts/load-test.ts — Load test for concurrent session capacity (Issue #2093)
 *
 * Creates N concurrent sessions, sends messages, and measures latency/throughput.
 *
 * Usage:
 *   npx tsx scripts/load-test.ts                          # defaults: 10 sessions
 *   npx tsx scripts/load-test.ts --concurrency 50          # 50 sessions
 *   npx tsx scripts/load-test.ts --levels 10,50,100        # run all three levels
 *   npx tsx scripts/load-test.ts --json > results.json     # JSON output
 *
 * Prerequisites:
 *   - Aegis server running (npm run dev or npm start)
 *   - tsx available (npx tsx works out of the box)
 */

import { tmpdir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Config {
  baseUrl: string;
  authToken: string;
  levels: number[];
  messagesPerSession: number;
  workDir: string;
  jsonOnly: boolean;
  noCleanup: boolean;
}

interface Timing {
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

interface SessionResult {
  id: string;
  create: Timing;
  messages: Timing[];
}

interface LevelReport {
  concurrency: number;
  sessionsCreated: number;
  sessionsFailed: number;
  sessionCreateMs: number[];
  sessionCreateTotalMs: number;
  sessionsPerSec: number;
  messagesSent: number;
  messagesFailed: number;
  messageRttMs: number[];
  messageTotalMs: number;
  messagesPerSec: number;
  overallErrorRate: number;
  cleanedUp: number;
  cleanupFailed: number;
}

interface FullReport {
  timestamp: string;
  config: Config;
  levels: LevelReport[];
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Config {
  const val = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : fallback;
  };

  const levelsRaw = val('--levels', '');
  const concRaw = val('--concurrency', '10');

  const levels = levelsRaw
    ? levelsRaw.split(',').map((s) => Number(s.trim()))
    : [Number(concRaw)];

  return {
    baseUrl: val('--url', process.env.AEGIS_BASE_URL ?? 'http://127.0.0.1:9100'),
    authToken: val('--token', process.env.AEGIS_AUTH_TOKEN ?? ''),
    levels,
    messagesPerSession: Number(val('--messages', '1')),
    workDir: val('--work-dir', path.join(tmpdir(), 'aegis-load-test')),
    jsonOnly: argv.includes('--json'),
    noCleanup: argv.includes('--no-cleanup'),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function authHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function apiCall(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; json: unknown; durationMs: number }> {
  const start = performance.now();
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const durationMs = performance.now() - start;
  const json = await res.json().catch(() => null);
  return { status: res.status, json, durationMs };
}

// ---------------------------------------------------------------------------
// Test operations
// ---------------------------------------------------------------------------

async function createSession(
  baseUrl: string,
  hdr: Record<string, string>,
  workDir: string,
): Promise<{ id: string; timing: Timing }> {
  const start = performance.now();
  try {
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ workDir }),
    });
    const durationMs = performance.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        id: '',
        timing: { ok: false, status: res.status, durationMs, error: `HTTP ${res.status}: ${body.slice(0, 200)}` },
      };
    }
    const body = (await res.json()) as { id: string };
    return { id: body.id, timing: { ok: true, status: res.status, durationMs } };
  } catch (err) {
    return {
      id: '',
      timing: {
        ok: false,
        status: 0,
        durationMs: performance.now() - start,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function sendMessage(
  baseUrl: string,
  hdr: Record<string, string>,
  sessionId: string,
  text: string,
): Promise<Timing> {
  const start = performance.now();
  try {
    const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/send`, {
      method: 'POST',
      headers: hdr,
      body: JSON.stringify({ text }),
    });
    const durationMs = performance.now() - start;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, durationMs, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, status: res.status, durationMs };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      durationMs: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function deleteSession(
  baseUrl: string,
  hdr: Record<string, string>,
  sessionId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: hdr,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function stats(sorted: number[]): { min: number; p50: number; p95: number; p99: number; max: number; avg: number } {
  if (sorted.length === 0) return { min: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0]!,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
  };
}

// ---------------------------------------------------------------------------
// Per-level runner
// ---------------------------------------------------------------------------

async function runLevel(cfg: Config, concurrency: number): Promise<LevelReport> {
  const hdr = authHeaders(cfg.authToken);
  const log = cfg.jsonOnly ? () => {} : (msg: string) => process.stderr.write(`  ${msg}\n`);

  log(`Creating ${concurrency} sessions ...`);

  // Phase 1 — create sessions concurrently
  const createStart = performance.now();
  const createResults = await Promise.all(
    Array.from({ length: concurrency }, () => createSession(cfg.baseUrl, hdr, cfg.workDir)),
  );
  const createTotalMs = performance.now() - createStart;

  const sessionIds: string[] = [];
  const createMs: number[] = [];
  let sessionsFailed = 0;

  for (const r of createResults) {
    createMs.push(r.timing.durationMs);
    if (r.timing.ok && r.id) {
      sessionIds.push(r.id);
    } else {
      sessionsFailed++;
      log(`  FAIL create: ${r.timing.error ?? `status ${r.timing.status}`}`);
    }
  }

  const sessionsPerSec = sessionIds.length > 0 ? (sessionIds.length / createTotalMs) * 1000 : 0;
  log(`  Created ${sessionIds.length}/${concurrency} in ${createTotalMs.toFixed(0)}ms (${sessionsPerSec.toFixed(1)}/s)`);

  // Phase 2 — send messages concurrently
  const msgRttMs: number[] = [];
  let messagesSent = 0;
  let messagesFailed = 0;
  let msgTotalMs = 0;

  if (sessionIds.length > 0 && cfg.messagesPerSession > 0) {
    log(`Sending ${cfg.messagesPerSession} message(s) to each of ${sessionIds.length} sessions ...`);
    const msgStart = performance.now();

    const msgPromises = sessionIds.flatMap((id) =>
      Array.from({ length: cfg.messagesPerSession }, (_, i) =>
        sendMessage(cfg.baseUrl, hdr, id, `load-test-msg-${i}`),
      ),
    );

    const msgResults = await Promise.all(msgPromises);
    msgTotalMs = performance.now() - msgStart;

    for (const t of msgResults) {
      msgRttMs.push(t.durationMs);
      if (t.ok) {
        messagesSent++;
      } else {
        messagesFailed++;
        log(`  FAIL send: ${t.error ?? `status ${t.status}`}`);
      }
    }

    const messagesPerSec = messagesSent > 0 ? (messagesSent / msgTotalMs) * 1000 : 0;
    log(`  Sent ${messagesSent}/${msgPromises.length} in ${msgTotalMs.toFixed(0)}ms (${messagesPerSec.toFixed(1)}/s)`);
  }

  // Phase 3 — cleanup
  let cleanedUp = 0;
  let cleanupFailed = 0;

  if (!cfg.noCleanup && sessionIds.length > 0) {
    log(`Cleaning up ${sessionIds.length} sessions ...`);
    const cleanupResults = await Promise.all(
      sessionIds.map((id) => deleteSession(cfg.baseUrl, hdr, id)),
    );
    for (const ok of cleanupResults) {
      if (ok) cleanedUp++;
      else cleanupFailed++;
    }
    log(`  Cleaned ${cleanedUp}, failed ${cleanupFailed}`);
  }

  const totalOps = sessionIds.length + messagesSent + messagesFailed;
  const totalErrors = sessionsFailed + messagesFailed;
  const overallErrorRate = totalOps > 0 ? totalErrors / totalOps : 0;

  return {
    concurrency,
    sessionsCreated: sessionIds.length,
    sessionsFailed,
    sessionCreateMs: createMs,
    sessionCreateTotalMs: createTotalMs,
    sessionsPerSec,
    messagesSent,
    messagesFailed,
    messageRttMs,
    messageTotalMs: msgTotalMs,
    messagesPerSec: messagesSent > 0 ? (messagesSent / msgTotalMs) * 1000 : 0,
    overallErrorRate,
    cleanedUp,
    cleanupFailed,
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function printTable(levels: LevelReport[]): void {
  const w = (s: string, n: number) => s.padEnd(n);

  console.log('\n┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│                        Load Test Results                                     │');
  console.log('├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤');
  console.log('│ Concur.  │ Created  │ Ses/sec  │ Msg/sec  │ Err Rate │ Ses p95  │ Msg p95  │');
  console.log('├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');

  for (const lv of levels) {
    const cStats = stats([...lv.sessionCreateMs].sort((a, b) => a - b));
    const mStats = stats([...lv.messageRttMs].sort((a, b) => a - b));
    const errPct = (lv.overallErrorRate * 100).toFixed(1) + '%';

    console.log(
      `│ ${w(String(lv.concurrency), 8)} ` +
      `│ ${w(`${lv.sessionsCreated}/${lv.concurrency}`, 8)} ` +
      `│ ${w(lv.sessionsPerSec.toFixed(1), 8)} ` +
      `│ ${w(lv.messagesPerSec.toFixed(1), 8)} ` +
      `│ ${w(errPct, 8)} ` +
      `│ ${w(formatMs(cStats.p95), 8)} ` +
      `│ ${w(formatMs(mStats.p95), 8)} │`,
    );
  }

  console.log('└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');

  // Detailed per-level stats
  for (const lv of levels) {
    const cStats = stats([...lv.sessionCreateMs].sort((a, b) => a - b));
    const mStats = stats([...lv.messageRttMs].sort((a, b) => a - b));

    console.log(`\n  Level ${lv.concurrency} — Session Create Latency`);
    console.log(`    min=${formatMs(cStats.min)} p50=${formatMs(cStats.p50)} p95=${formatMs(cStats.p95)} p99=${formatMs(cStats.p99)} max=${formatMs(cStats.max)} avg=${formatMs(cStats.avg)}`);

    if (lv.messageRttMs.length > 0) {
      console.log(`  Level ${lv.concurrency} — Message RTT Latency`);
      console.log(`    min=${formatMs(mStats.min)} p50=${formatMs(mStats.p50)} p95=${formatMs(mStats.p95)} p99=${formatMs(mStats.p99)} max=${formatMs(mStats.max)} avg=${formatMs(mStats.avg)}`);
    }

    if (lv.sessionsFailed > 0 || lv.messagesFailed > 0) {
      console.log(`  Errors: ${lv.sessionsFailed} session creates, ${lv.messagesFailed} messages`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));
  const hdr = authHeaders(cfg.authToken);

  // Health check
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/health`, { headers: hdr });
    if (!res.ok) {
      console.error(`Health check failed: HTTP ${res.status}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Cannot reach Aegis at ${cfg.baseUrl}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (!cfg.jsonOnly) {
    console.log(`Aegis load test — ${cfg.baseUrl}`);
    console.log(`Levels: ${cfg.levels.join(', ')} | Messages/session: ${cfg.messagesPerSession} | Work dir: ${cfg.workDir}`);
    console.log();
  }

  const levels: LevelReport[] = [];

  for (const c of cfg.levels) {
    if (!cfg.jsonOnly) console.log(`--- Concurrency ${c} ---`);
    const report = await runLevel(cfg, c);
    levels.push(report);
  }

  // JSON output
  if (cfg.jsonOnly) {
    const full: FullReport = {
      timestamp: new Date().toISOString(),
      config: cfg,
      levels: levels.map((lv) => ({
        ...lv,
        sessionCreateMs: lv.sessionCreateMs,
        messageRttMs: lv.messageRttMs,
      })),
    };
    console.log(JSON.stringify(full, null, 2));
  } else {
    printTable(levels);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

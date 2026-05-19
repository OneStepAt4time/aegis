/**
 * commands/status.ts — `ag status [session-id]` — Show server health or session details.
 *
 * Without a session ID: wraps GET /v1/health and GET /v1/sessions/stats.
 * With a session ID:    wraps GET /v1/sessions/:id (+ optional metrics).
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';
import { resolveSessionId } from './read.js';

export async function handleStatus(args: string[], io: CliIO): Promise<number> {
  const sessionId = args.find(a => !a.startsWith('-'));
  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;
  const headers = buildHeaders(authToken);

  if (sessionId) {
    return handleSessionStatus(sessionId, baseUrl, headers, io);
  }

  // Server health (no session ID)
  const healthRes = await fetch(`${baseUrl}/v1/health`, { headers, signal: AbortSignal.timeout(5000) });
  if (!healthRes.ok) {
    writeLine(io.stderr, `  ❌ Health check failed: ${healthRes.statusText}`);
    return 1;
  }
  const health = await healthRes.json() as Record<string, unknown>;

  writeLine(io.stdout, '  Aegis Status');
  writeLine(io.stdout, '  ────────────');
  writeLine(io.stdout, `  Version:   ${health.version ?? 'unknown'}`);
  writeLine(io.stdout, `  Status:    ${health.status ?? 'unknown'}`);
  writeLine(io.stdout, `  Uptime:    ${health.uptime != null ? formatUptime(health.uptime as number) : 'unknown'}`);
  if (health.port) writeLine(io.stdout, `  Port:      ${health.port}`);

  try {
    const statsRes = await fetch(`${baseUrl}/v1/sessions/stats`, { headers, signal: AbortSignal.timeout(5000) });
    if (statsRes.ok) {
      const stats = await statsRes.json() as Record<string, unknown>;
      writeLine(io.stdout, `  Sessions:  ${stats.active ?? stats.running ?? 0} active / ${stats.total ?? 0} total`);
    }
  } catch {
    // Stats endpoint may not exist — skip
  }

  return 0;
}

async function handleSessionStatus(
  sessionId: string,
  baseUrl: string,
  headers: Record<string, string>,
  io: CliIO,
): Promise<number> {
  const resolvedId = await resolveSessionId(sessionId, baseUrl, headers, io);
  if (!resolvedId) return 1;

  const res = await fetch(`${baseUrl}/v1/sessions/${resolvedId}`, {
    headers,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    if (res.status === 404) {
      writeLine(io.stderr, `  ❌ Session not found: ${sessionId}`);
    } else {
      writeLine(io.stderr, `  ❌ Failed to fetch session: ${res.statusText}`);
    }
    return 1;
  }

  const session = await res.json() as Record<string, unknown>;

  let costDisplay = 'n/a';
  try {
    const metricsRes = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/metrics`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (metricsRes.ok) {
      const m = await metricsRes.json() as { tokenUsage?: { estimatedCostUsd?: number } };
      if (m.tokenUsage?.estimatedCostUsd != null) {
        costDisplay = `$${m.tokenUsage.estimatedCostUsd.toFixed(4)}`;
      }
    }
  } catch {
    // Metrics may not be available
  }

  const createdAt = typeof session.createdAt === 'number' ? session.createdAt : null;
  const lastActivity = typeof session.lastActivity === 'number' ? session.lastActivity : null;
  const now = Date.now();

  writeLine(io.stdout, `  Session: ${resolvedId}`);
  writeLine(io.stdout, '  ─────────────────────────────────────');
  writeLine(io.stdout, `  Status:        ${session.status ?? 'unknown'}`);
  if (session.model) writeLine(io.stdout, `  Model:         ${session.model}`);
  writeLine(io.stdout, `  Cost:          ${costDisplay}`);
  writeLine(io.stdout, `  Duration:      ${createdAt != null ? formatUptime((now - createdAt) / 1000) : 'unknown'}`);
  writeLine(io.stdout, `  Last activity: ${lastActivity != null ? formatRelativeTime(lastActivity, now) : 'unknown'}`);

  return 0;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatRelativeTime(ts: number, now: number): string {
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 0) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ${diffMin % 60}m ago`;
}

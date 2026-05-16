/**
 * commands/status.ts — `ag status` — Show server health and session summary.
 *
 * Wraps GET /v1/health and GET /v1/sessions/stats.
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

export async function handleStatus(args: string[], io: CliIO): Promise<number> {
  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);

  // Fetch health
  const healthRes = await fetch(`${baseUrl}/v1/health`, { headers, signal: AbortSignal.timeout(5000) });
  if (!healthRes.ok) {
    writeLine(io.stderr, `  ❌ Health check failed: ${healthRes.statusText}`);
    return 1;
  }
  const health = await healthRes.json() as Record<string, any>;

  writeLine(io.stdout, '  Aegis Status');
  writeLine(io.stdout, '  ────────────');
  writeLine(io.stdout, `  Version:   ${health.version ?? 'unknown'}`);
  writeLine(io.stdout, `  Status:    ${health.status ?? 'unknown'}`);
  writeLine(io.stdout, `  Uptime:    ${health.uptime != null ? formatUptime(health.uptime) : 'unknown'}`);
  if (health.port) writeLine(io.stdout, `  Port:      ${health.port}`);

  // Fetch session stats
  try {
    const statsRes = await fetch(`${baseUrl}/v1/sessions/stats`, { headers, signal: AbortSignal.timeout(5000) });
    if (statsRes.ok) {
      const stats = await statsRes.json() as Record<string, any>;
      writeLine(io.stdout, `  Sessions:  ${stats.active ?? stats.running ?? 0} active / ${stats.total ?? 0} total`);
    }
  } catch {
    // Stats endpoint may not exist — skip
  }

  return 0;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

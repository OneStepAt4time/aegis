/**
 * commands/list.ts — `ag list` — List active sessions.
 *
 * Wraps GET /v1/sessions with optional status and project (`--cwd`) filters.
 * Issue #3633: Add --full-ids and --json flags for better CLI workflow.
 * Issue #3731: Hide killed/completed/crashed by default; --all shows everything.
 * Issue #3894: Mention partial ID support in tips.
 * Issue #4457: --json now outputs structured { sessions, pagination } matching
 *   the API response, and errors are emitted as JSON to stdout.
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

/** Statuses considered "terminal" — hidden from `ag list` unless --all is passed. */
const TERMINAL_STATUSES = new Set(['killed', 'completed', 'crashed']);

export async function handleList(args: string[], io: CliIO): Promise<number> {
  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);
  const params = new URLSearchParams();

  let fullIds = false;
  let jsonOutput = false;
  let showAll = false;
  // When true, user requested logical "active" which means "not terminal"
  let statusActiveFilter = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status' && args[i + 1]) {
      const v = args[++i]!;
      if (v.toLowerCase() === 'active') {
        statusActiveFilter = true;
      } else {
        params.set('status', v);
      }
    } else if (args[i] === '--cwd' && args[i + 1]) {
      params.set('project', args[i + 1]!);
      i++;
    } else if (args[i] === '--full-ids' || args[i] === '--full') {
      fullIds = true;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    } else if (args[i] === '--all') {
      showAll = true;
    }
  }

  const url = `${baseUrl}/v1/sessions${params.toString() ? '?' + params : ''}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message = ((err as { error?: string }).error) || res.statusText;
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: message }));
    } else {
      writeLine(io.stderr, `  ❌ ${message}`);
    }
    return 1;
  }

  const body = await res.json() as { sessions?: any[]; data?: any[]; pagination?: any };
  let sessions = body.sessions ?? body.data ?? [];

  // #3731: Filter terminal statuses unless --all
  if (!showAll) {
    sessions = sessions.filter(s => !TERMINAL_STATUSES.has(s.status));
  }

  if (jsonOutput) {
    // #4457: Output structured response matching API format
    writeLine(io.stdout, JSON.stringify({ sessions, pagination: body.pagination ?? null }, null, 2));
    return 0;
  }

  if (sessions.length === 0) {
    writeLine(io.stdout, showAll ? '  No sessions found.' : '  No active sessions. Use --all to include killed/completed/crashed.');
    return 0;
  }

  writeLine(io.stdout, `  Sessions (${sessions.length}):`);
  for (const s of sessions) {
    const id = fullIds ? (s.id as string) : (s.id as string)?.slice(0, 8) ?? '????????';
    const suffix = fullIds ? '' : '…';
    const name = s.displayName ?? s.name ?? 'unnamed';
    const status = s.status ?? 'unknown';
    writeLine(io.stdout, `    ${id}${suffix}  ${status.padEnd(12)}  ${name}`);
  }

  const tips: string[] = [];
  if (!fullIds) tips.push('--full-ids to show full UUIDs');
  if (!showAll) tips.push('--all to include killed/completed/crashed');
  if (tips.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `  Tip: use ${tips.join(', ')}, or pipe with --json.`);
    writeLine(io.stdout, '  Partial IDs (e.g. ag read 786d9a13) are supported by read, kill, tail, and status.');
  }

  return 0;
}

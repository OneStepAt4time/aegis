/**
 * commands/approve.ts — `ag approve <id> [approval-id]` — Approve a pending tool call.
 *
 * Wraps POST /v1/sessions/:id/approval/approve.
 * Issue #4685: CLI approval commands for headless/agent use cases.
 *
 * Usage:
 *   ag approve <session-id>              Approve the pending approval (if exactly one)
 *   ag approve <session-id> <approval-id> Approve a specific approval by ID
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';
import { resolveSessionId } from './read.js';

export async function handleApprove(args: string[], io: CliIO): Promise<number> {
  // Parse: ag approve <session-id> [approval-id]
  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const sessionId = positionalArgs[0];
  const approvalId = positionalArgs[1];

  if (!sessionId) {
    writeLine(io.stderr, '  ❌ Missing session ID. Usage: ag approve <session-id> [approval-id]');
    return 1;
  }

  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);
  headers['Content-Type'] = 'application/json';

  // Resolve prefix to full UUID
  const resolvedId = await resolveSessionId(sessionId, baseUrl, headers, io);
  if (!resolvedId) return 1;

  // If no approvalId provided, check for pending approvals
  let targetApprovalId = approvalId;
  if (!targetApprovalId) {
    const pendingRes = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/approval/pending`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!pendingRes.ok) {
      const err = await pendingRes.json().catch(() => ({ error: pendingRes.statusText }));
      writeLine(io.stderr, `  ❌ Failed to fetch pending approvals: ${((err as { error?: string }).error) || pendingRes.statusText}`);
      return 1;
    }

    const pending = await pendingRes.json() as { pending: { approvalId: string; toolName?: string }[] | null };
    const pendingList = pending.pending ?? [];

    if (pendingList.length === 0) {
      writeLine(io.stderr, '  ❌ No pending approvals for this session.');
      return 1;
    }

    if (pendingList.length > 1) {
      writeLine(io.stderr, `  ❌ Multiple pending approvals (${pendingList.length}). Specify one:`);
      for (const p of pendingList) {
        writeLine(io.stderr, `    ${p.approvalId} — ${p.toolName ?? 'unknown tool'}`);
      }
      return 1;
    }

    targetApprovalId = pendingList[0]!.approvalId;
    writeLine(io.stdout, `  📝 Auto-selecting approval: ${targetApprovalId} — ${pendingList[0]!.toolName ?? 'unknown tool'}`);
  }

  // Approve the tool call
  const res = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/approval/approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ approvalId: targetApprovalId }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as { error?: string }).error) || res.statusText}`);
    return 1;
  }

  const result = await res.json() as { status?: string; pendingPermission?: unknown };
  writeLine(io.stdout, `  ✅ Approved ${targetApprovalId.slice(0, 8)}…`);
  if (result.status) {
    writeLine(io.stdout, `  Session status: ${result.status}`);
  }

  return 0;
}

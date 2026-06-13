import { CliIO, writeLine, resolveAuthToken } from '../cli-http.js';
import { deriveBaseUrl, getConfiguredBaseUrl } from '../base-url.js';
import { loadConfig } from '../config.js';
import { getErrorMessage, parseIntSafe, validateEffort } from '../validation.js';
import { generateSessionName } from '../utils/session-name.js';

export async function handleCreate(args: string[], io: CliIO): Promise<number> {
  let brief = '';
  let cwd = process.cwd();
  let portOverride: number | null = null;
  let existingSessionId: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = args[++i]!;
    } else if (args[i] === '--port' && args[i + 1]) {
      portOverride = parseIntSafe(args[++i], 9100);
    } else if (args[i] === '--model' && args[i + 1] && !args[i + 1]!.startsWith('-')) {
      model = args[++i]!;
    } else if (args[i] === '--effort' && args[i + 1]) {
      const validated = validateEffort(args[++i]!);
      if (validated === null) {
        writeLine(io.stderr, '  \u274c Invalid --effort value.');
        return 1;
      }
      effort = validated;
  } else if (args[i] === '--session-id' && args[i + 1]) {
    existingSessionId = args[++i]!;
  } else if (args[i]?.startsWith('--session-id=')) {
    existingSessionId = args[i]!.slice('--session-id='.length);
    } else if (!args[i].startsWith('-')) {
      brief = args[i];
    }
  }

  const acceptPerms = args.includes('--accept-permissions') || args.includes('-y') || args.includes('--passthrough');

  if (!brief) {
    writeLine(io.stderr, '  ❌ Missing brief. Usage: ag create "Build a login page"');
    return 1;
  }

  const config = await loadConfig();
  const baseUrl = portOverride === null
    ? getConfiguredBaseUrl(config)
    : deriveBaseUrl('127.0.0.1', portOverride);
  const sessionName = generateSessionName(brief);
  const authToken = await resolveAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  // Issue #3306: Preflight auth check to prevent orphaned sessions.
  if (authToken) {
    try {
      const authRes = await fetch(`${baseUrl}/v1/sessions/stats`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (authRes.status === 401) {
        writeLine(io.stderr, '  ❌ Unauthorized — the server rejected the auth token.');
        writeLine(io.stderr, '  Run `ag init` or set AEGIS_AUTH_TOKEN=<your-key>.');
        return 1;
      }
    } catch {
      // Network error — proceed, session creation will fail anyway
    }
  }

  let sessionId: string;
  if (existingSessionId) {
    // Issue #3760: --session-id sends to an existing session instead of creating a new one.
    try {
      const checkRes = await fetch(`${baseUrl}/v1/sessions/${existingSessionId}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (checkRes.status === 404) {
        writeLine(io.stderr, `  ❌ Session ${existingSessionId.slice(0, 8)} not found.`);
        writeLine(io.stderr, '     List sessions with: ag list');
        return 1;
      }
      if (!checkRes.ok) {
        const err = await checkRes.json().catch(() => ({ error: checkRes.statusText }));
        writeLine(io.stderr, `  ❌ Failed to lookup session: ${(err as { error?: string }).error || checkRes.statusText}`);
        return 1;
      }
      sessionId = existingSessionId;
      writeLine(io.stdout, `  ✅ Using existing session: ${sessionId.slice(0, 8)}`);
    } catch (e: unknown) {
      writeLine(io.stderr, `  ❌ Cannot reach Aegis at ${baseUrl}: ${getErrorMessage(e)}`);
      return 1;
    }
  } else {
    try {
      const res = await fetch(`${baseUrl}/v1/sessions`, {
        signal: AbortSignal.timeout(30_000),
        method: 'POST',
        headers,
        body: JSON.stringify({ workDir: cwd, name: sessionName, model, effort, ...(acceptPerms ? { permissionMode: 'bypassPermissions' } : {}) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        writeLine(io.stderr, `  ❌ Failed to create session: ${(err as { error?: string }).error || res.statusText}`);
        return 1;
      }

      const session = await res.json() as { id: string; displayName: string };
      sessionId = session.id;
      writeLine(io.stdout, `  ✅ Session created: ${session.displayName}`);
      writeLine(io.stdout, `     ID: ${sessionId}`);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        writeLine(io.stderr, '  ❌ Session creation timed out after 30s.');
        writeLine(io.stderr, '     The server may be slow to respond. Try again or check server health.');
      } else {
        const cause = (e as { cause?: { code?: string } }).cause;
        if (cause?.code === 'ECONNREFUSED') {
          writeLine(io.stderr, `  ❌ Cannot connect to Aegis at ${baseUrl}.`);
          writeLine(io.stderr, '     Start the server first: ag');
        } else {
          writeLine(io.stderr, `  ❌ ${getErrorMessage(e)}`);
        }
      }
      return 1;
    }
  }

  try {
    const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/send`, {
      signal: AbortSignal.timeout(60_000),
      method: 'POST',
      headers,
      body: JSON.stringify({ text: brief }),
    });

    // Issue #3059: Don't show scary warning when agent hasn't started yet
    const result = await res.json() as { delivered?: boolean; attempts?: number };
    if (result.delivered) {
      writeLine(io.stdout, `  ✅ Brief delivered (attempt ${result.attempts})`);
    } else if ((result.attempts ?? 0) === 0) {
      writeLine(io.stdout, `  ✅ Brief queued — agent will pick up shortly`);
    } else {
      writeLine(io.stdout, `  ⚠️  Brief sent but delivery not confirmed after ${result.attempts} attempts`);
    }
  } catch (e: unknown) {
    writeLine(io.stderr, `  ⚠️  Failed to send brief: ${getErrorMessage(e)}`);
  }

  writeLine(io.stdout);
  writeLine(io.stdout, '  Next steps:');
  writeLine(io.stdout, `    Status:   ag status`);
  writeLine(io.stdout, `    Read:     ag read ${sessionId}`);
  writeLine(io.stdout, `    Tail:     ag tail ${sessionId}`);
  writeLine(io.stdout, `    Kill:     ag kill ${sessionId}`);
  return 0;
}

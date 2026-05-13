/**
 * commands/run.ts — One-liner mode: zero to running session in one command.
 *
 * `ag run "prompt"` does:
 * 1. Check if server is running (health check)
 * 2. If not: bootstrap config if needed → start server in background → wait for health
 * 3. Create session with the prompt
 * 4. Stream session output to terminal (SSE or polling)
 *
 * Issue #3043: Reduce install friction to a single command.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { deriveBaseUrl, getConfiguredBaseUrl, normalizeBaseUrl } from '../base-url.js';
import { AuthManager } from '../services/auth/index.js';
import { loadConfig, readConfigFile, writeConfigFile, serializeConfigFile, type Config } from '../config.js';
import { getErrorMessage, parseIntSafe } from '../validation.js';

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}

function resolveAuthToken(): string | undefined {
  return process.env.AEGIS_AUTH_TOKEN || process.env.AEGIS_TOKEN || undefined;
}

/** Check if the server is healthy at the given base URL. */
async function isServerHealthy(baseUrl: string, authToken?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/v1/health`, { headers, signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Wait for server to become healthy, polling every 500ms. */
async function waitForServer(baseUrl: string, authToken: string | undefined, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerHealthy(baseUrl, authToken)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Bootstrap config with sensible defaults if none exists.
 * Issue #3261: Use AuthManager to create a proper key in keys.json,
 * not a random token that the server won't recognize.
 */
async function ensureConfig(configPath: string, stateDir: string): Promise<string | undefined> {
  const existing = await readConfigFile(configPath);
  if (existing) {
    return existing.authToken || existing.clientAuthToken || undefined;
  }

  // Issue #3261: Use AuthManager to register the key in keys.json.
  // This mirrors what `ag init` does — the freshly-started server will
  // load keys.json and recognize the generated token.
  const authManager = new AuthManager(join(stateDir, 'keys.json'));
  await authManager.load();
  const createdKey = await authManager.createKey('ag-run-admin', 100, undefined, 'admin');
  const token = createdKey.key;

  const config: Partial<Config> = {
    authToken: token,
    baseUrl: 'http://127.0.0.1:9100',
    dashboardEnabled: true,
    acpEnabled: true,
  };

  const content = serializeConfigFile(config, configPath);
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, content, { mode: 0o600 });

  return token;
}

/** Start the server as a detached child process. */
function startServer(cwd: string): ChildProcess {
  const child = spawn(process.execPath, [join(cwd, 'dist/cli.js'), 'start', '--foreground'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  return child;
}

/** Default config file path. */
function defaultConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, 'aegis', 'config.yaml');
  return join(homedir(), '.aegis', 'config.yaml');
}

/** Stream session transcript/output to terminal using polling. */
async function streamOutput(baseUrl: string, sessionId: string, authToken: string | undefined, io: CliIO): Promise<void> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let lastLineCount = 0;
  const maxIdleMs = 120_000; // 2 min idle timeout
  let lastActivity = Date.now();

  writeLine(io.stdout);
  writeLine(io.stdout, '  📡 Streaming session output (Ctrl+C to stop)...');
  writeLine(io.stdout);

  try {
    while (Date.now() - lastActivity < maxIdleMs) {
      const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/read`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        // Session might have ended
        if (res.status === 404) break;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const data = await res.json() as {
        lines?: Array<{ text: string; role?: string }>;
        transcript?: Array<{ text: string; role?: string }>;
        status?: string;
      };

      // Support both `lines` and `transcript` response shapes
      const entries = data.lines || data.transcript || [];
      if (entries.length > lastLineCount) {
        const newEntries = entries.slice(lastLineCount);
        for (const entry of newEntries) {
          const prefix = entry.role === 'user' ? '  👤 ' : entry.role === 'assistant' ? '  🤖 ' : '  ';
          writeLine(io.stdout, `${prefix}${entry.text.slice(0, 500)}`);
        }
        lastLineCount = entries.length;
        lastActivity = Date.now();
      }

      // Check if session is done
      if (data.status === 'completed' || data.status === 'error' || data.status === 'killed') {
        writeLine(io.stdout);
        writeLine(io.stdout, `  Session ended: ${data.status}`);
        break;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (e) {
    writeLine(io.stderr, `  ⚠️  Stream interrupted: ${getErrorMessage(e)}`);
  }
}

export async function handleRun(args: string[], io: CliIO): Promise<number> {
  // Extract prompt
  const brief = args.find((a) => !a.startsWith('-'));
  if (!brief) {
    writeLine(io.stderr, '  ❌ Missing prompt. Usage: ag run "Build a REST API" [--cwd /path]');
    return 1;
  }

  // Extract --cwd
  const cwdIdx = args.indexOf('--cwd');
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? resolve(args[cwdIdx + 1]) : process.cwd();

  // Extract --port
  const portIdx = args.indexOf('--port');
  const portOverride = portIdx !== -1 ? parseIntSafe(args[portIdx + 1], 9100) : null;

  const noStream = args.includes('--no-stream');

  writeLine(io.stdout, `  🚀 ag run: ${brief.slice(0, 60)}${brief.length > 60 ? '...' : ''}`);

  // Determine config path and base URL
  const configPath = defaultConfigPath();
  const existingConfig = await readConfigFile(configPath);
  const config = await loadConfig();
  const baseUrl = portOverride !== null
    ? deriveBaseUrl('127.0.0.1', portOverride)
    : getConfiguredBaseUrl(config);

  // Check if server is running
  let authToken = resolveAuthToken() || config.authToken || config.clientAuthToken || undefined;
  let serverRunning = await isServerHealthy(baseUrl, authToken);

  if (!serverRunning) {
    writeLine(io.stdout, '  ⏳ Server not running — starting...');

    // Ensure config exists (creates proper key in keys.json via AuthManager)
    if (!existingConfig) {
      writeLine(io.stdout, '  ⏳ No config found — bootstrapping with defaults...');
      const generatedToken = await ensureConfig(configPath, config.stateDir);
      if (generatedToken) authToken = generatedToken;
      writeLine(io.stdout, `  ✅ Config created: ${configPath}`);
    }

    // Start server
    const serverDir = join(import.meta.dirname || __dirname, '..');
    startServer(serverDir);

    // Wait for server
    writeLine(io.stdout, '  ⏳ Waiting for server...');
    const started = await waitForServer(baseUrl, authToken, 15_000);
    if (!started) {
      // Issue #3067: Race condition — an existing Aegis server may be on the port
      // but was in a crash loop when we first checked. Retry health check once
      // more before giving up — the existing server may have recovered.
      writeLine(io.stdout, '  ⏳ Retrying health check (existing server may have recovered)...');
      if (await isServerHealthy(baseUrl, authToken)) {
        writeLine(io.stdout, '  ✅ Connected to existing server');
      } else {
        writeLine(io.stderr, '  ❌ Server failed to start within 15 seconds.');
        writeLine(io.stderr, '     Try starting manually: ag');
        return 1;
      }
    } else {
      writeLine(io.stdout, '  ✅ Server started');
    }
  }

  // Create session
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let sessionId: string;
  try {
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),  // Issue #3243: session creation is now fast (prompt delivery is async)
      headers,
      body: JSON.stringify({
        workDir: cwd,
        prompt: brief,
        name: `run-${brief.slice(0, 20).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`,
      }),
    });

    if (!res.ok) {
      // Issue #3261: When a server is already running with auth but the CLI has
      // no matching token, provide a clear actionable error instead of a generic one.
      if (res.status === 401) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        writeLine(io.stderr, '');
        writeLine(io.stderr, '  ❌ Unauthorized — the server requires authentication.');
        writeLine(io.stderr, '');
        writeLine(io.stderr, '  This happens when a server is already running with API keys configured');
        writeLine(io.stderr, '  but no matching auth token is available locally.');
        writeLine(io.stderr, '');
        writeLine(io.stderr, '  To fix this:');
        writeLine(io.stderr, '    1. Run `ag init` to create a new API key and config');
        writeLine(io.stderr, '    2. Or set AEGIS_AUTH_TOKEN=<your-key> in your environment');
        writeLine(io.stderr, '');
        writeLine(io.stderr, '  If you set up the server, your original token was shown by `ag init`.');
        writeLine(io.stderr, '  Check your shell history or re-run `ag init --force` to generate a new one.');
        return 1;
      }

      const err = await res.json().catch(() => ({ error: res.statusText }));
      writeLine(io.stderr, `  ❌ Failed to create session: ${(err as { error?: string }).error || res.statusText}`);
      return 1;
    }

    const session = await res.json() as { id: string; displayName: string; promptDelivery?: { status?: string } };
    sessionId = session.id;
    writeLine(io.stdout, `  ✅ Session: ${session.displayName} (${sessionId.slice(0, 8)})`);

    // Issue #3243: Poll for async prompt delivery if pending
    if (session.promptDelivery?.status === 'pending') {
      writeLine(io.stdout, '  ⏳ Delivering prompt...');
      const pollStart = Date.now();
      const pollTimeout = 180_000; // 3 min max wait for prompt delivery
      while (Date.now() - pollStart < pollTimeout) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const pollRes = await fetch(`${baseUrl}/v1/sessions/${sessionId}`, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            signal: AbortSignal.timeout(5000),
          });
          if (pollRes.ok) {
            const pollData = await pollRes.json() as { promptDelivery?: { status?: string; delivered?: boolean } };
            const pdStatus = pollData.promptDelivery?.status;
            if (pdStatus === 'delivered') {
              writeLine(io.stdout, '  ✅ Prompt delivered');
              break;
            } else if (pdStatus === 'failed' || pdStatus === 'timeout') {
              writeLine(io.stderr, `  ⚠️  Prompt delivery ${pdStatus}. Session exists but agent may not have received the prompt.`);
              break;
            }
          }
        } catch {
          // Polling error — session may still be initializing
        }
      }
      if (Date.now() - pollStart >= pollTimeout) {
        writeLine(io.stderr, '  ⚠️  Prompt delivery timed out after 3 minutes. Session exists but agent may be slow to respond.');
      }
    }
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause;
    const errMessage = getErrorMessage(e);
    if (e instanceof DOMException && e.name === 'AbortError') {
      writeLine(io.stderr, `  ❌ Session creation timed out after 120s. The server may be slow to respond with your LLM provider.`);
      writeLine(io.stderr, `     Try setting AEGIS_ACP_PROMPT_TIMEOUT_MS=180000 and restarting.`);
    } else if (cause?.code === 'ECONNREFUSED') {
      writeLine(io.stderr, `  ❌ Cannot connect to server at ${baseUrl}.`);
    } else {
      writeLine(io.stderr, `  ❌ ${errMessage}`);
    }
    return 1;
  }

  // Dashboard URL
  const dashboardUrl = baseUrl.replace('/v1', '');
  writeLine(io.stdout, `  📊 Dashboard: ${dashboardUrl}`);

  if (noStream) {
    // Print curl commands and exit
    const curlAuth = authToken ? ` -H "Authorization: Bearer ${authToken}"` : '';
    writeLine(io.stdout);
    writeLine(io.stdout, '  Next steps:');
    writeLine(io.stdout, `    Status:   curl${curlAuth} ${baseUrl}/v1/sessions/${sessionId}/health`);
    writeLine(io.stdout, `    Read:     curl${curlAuth} ${baseUrl}/v1/sessions/${sessionId}/read`);
    return 0;
  }

  // Stream output
  await streamOutput(baseUrl, sessionId, authToken, io);
  return 0;
}

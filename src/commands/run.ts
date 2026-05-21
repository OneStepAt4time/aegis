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
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { deriveBaseUrl, getConfiguredBaseUrl, normalizeBaseUrl } from '../base-url.js';
import { AuthManager } from '../services/auth/index.js';
import { findConfigFilePath, loadConfig, readConfigFile, writeConfigFile, serializeConfigFile, type Config } from '../config.js';
import { getErrorMessage, parseIntSafe, validateEffort, validateModel } from '../validation.js';
import { generateSessionName } from '../utils/session-name.js';
import { readAuthTokenFile } from '../utils/auth-token-path.js';
import { checkClaudeInstalled, hasAnthropicCredentials } from '../utils/claude-installer.js';

import { isRateLimitError } from '../rate-limit.js';
import { CliIO, writeLine } from '../cli-http.js';

async function resolveAuthToken(): Promise<string | undefined> {
  const envToken = process.env.AEGIS_AUTH_TOKEN || process.env.AEGIS_TOKEN;
  if (envToken) return envToken;

  // #3369: Check auth-token file as fallback (respects AEGIS_STATE_DIR)
  const fileToken = readAuthTokenFile();
  if (fileToken) return fileToken;

  // #3340: Search config files for clientAuthToken/authToken as last resort.
  // Covers the case where ag init wrote the token to a config but the
  // auth-token file is missing (e.g., partial state, file deleted).
  try {
    const { loadConfig } = await import('../config.js');
    const config = await loadConfig();
    return config.clientAuthToken || config.authToken || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Issue #3306: Verify auth credentials against the server before attempting
 * to create a session. Prevents orphaned sessions when the CLI has an invalid
 * or missing token but the server requires authentication.
 * Returns true if auth is OK (or server doesn't require auth), false on 401.
 */
async function verifyAuth(baseUrl: string, authToken: string | undefined): Promise<{ ok: boolean; status?: number }> {
  try {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/v1/sessions/stats`, { headers, signal: AbortSignal.timeout(5000) });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, status: 401 };
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Check if the server is healthy at the given base URL.
 *  #3346: Also checks PID file as a fallback when the health endpoint times out.
 *  If the PID file exists and the process is alive, assume the server is running. */
async function isServerHealthy(baseUrl: string, authToken?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/v1/health`, { headers, signal: AbortSignal.timeout(3000) });
    if (res.ok) return true;
    // Non-401 error or network issue — fall through to PID file check
  } catch {
    // Network error — fall through to PID file check
  }

  // #3346: Fallback — check if an Aegis server PID file exists with a live process
  try {
    const { existsSync, readFileSync } = await import('node:fs');
    const stateDir = process.env.AEGIS_STATE_DIR || join(homedir(), '.aegis');
    const pidFile = join(stateDir, 'aegis.pid');
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      if (pid > 0 && pidExists(pid)) {
        return true;
      }
    }
  } catch {
    // Ignore
  }

  return false;
}

/** Check if a process with the given PID is alive. */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
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
async function ensureConfig(configPath: string, stateDir: string, port?: number): Promise<string | undefined> {
  const existing = await readConfigFile(configPath);
  if (existing) {
    // #3343: Update baseUrl in existing config when --port is specified
    if (port !== undefined) {
      const { writeConfigFile, serializeConfigFile } = await import('../config.js');
      const updated = { ...existing, baseUrl: `http://127.0.0.1:${port}` };
      await writeConfigFile(configPath, updated);
    }
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
    baseUrl: port ? `http://127.0.0.1:${port}` : 'http://127.0.0.1:9100',
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
function startServer(cwd: string, port?: number): ChildProcess {
  const env = { ...process.env };
  if (port !== undefined) env.AEGIS_PORT = String(port);
  const child = spawn(process.execPath, [join(cwd, 'dist/cli.js'), 'start', '--foreground'], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
  return child;
}

/** Default config file path.
 *  Searches for project-local .aegis/config.yaml (walking up from CWD),
 *  then falls back to the XDG/home config location.
 */
function defaultConfigPath(): string {
  const found = findConfigFilePath();
  if (found) return found;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, 'aegis', 'config.yaml');
  return join(homedir(), '.aegis', 'config.yaml');
}

/** Issue #3696: Poll until session completes, then print all output.
 *  Used by --no-stream to wait for completion without streaming line-by-line.
 *  @returns true if output was received, false if timed out. */
async function pollUntilComplete(baseUrl: string, sessionId: string, authToken: string | undefined, io: CliIO, maxWaitMs: number = 300_000): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const start = Date.now();
  const pollInterval = 3_000; // 3s between polls
  let dots = 0;

  writeLine(io.stdout);
  writeLine(io.stdout, '  ⏳ Waiting for session to complete...');

  try {
    while (Date.now() - start < maxWaitMs) {
      const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        if (res.status === 404) break;
        if (res.status === 429) {
          // Rate limit while waiting for session to appear / be ready
          const body = await res.text().catch(() => res.statusText);
          writeLine(io.stderr);
          writeLine(io.stderr, '  ❌ Rate limit detected while waiting for session (HTTP 429).');
          if (body) writeLine(io.stderr, f"    {body[:1000]}");
          process.exitCode = 2;
          return false;
        }
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }

      const data = await res.json() as { status?: string };
      dots = (dots + 1) % 4;
      const dotStr = '.'.repeat(dots);
      process.stdout.write(`\r  ⏳ Status: ${data.status ?? 'unknown'}${dotStr}   `);

      // Check if session is done
      if (data.status === 'idle' || data.status === 'completed' || data.status === 'error' || data.status === 'killed' || data.status === 'crashed') {
        process.stdout.write('\r' + ' '.repeat(50) + '\r');
        break;
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }
  } catch {
    // Connection lost
  }

  // Session done (or timed out) — fetch and print all messages
  writeLine(io.stdout);
  writeLine(io.stdout, '  📋 Session output:');
  writeLine(io.stdout);

  try {
    const readRes = await fetch(`${baseUrl}/v1/sessions/${sessionId}/read`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (readRes.ok) {
      const readData = await readRes.json() as {
        messages?: Array<{ text: string; role?: string; contentType?: string }>;
        status?: string;
        statusText?: string | null;
      };

      const entries = readData.messages || [];
      if (entries.length === 0) {
        writeLine(io.stdout, '  (no output received)');
        return false;
      }

      for (const entry of entries) {
        // Skip non-text content types (thinking, tool_use, tool_result, etc.)
        if (entry.contentType && entry.contentType !== 'text') continue;
        const prefix = entry.role === 'user' ? '  👤 ' : entry.role === 'assistant' ? '  🤖 ' : '  ';
        writeLine(io.stdout, `${prefix}${entry.text.slice(0, 2000)}`);
      }

      writeLine(io.stdout);
      if (readData.status === 'error') {
        writeLine(io.stderr, `  ❌ Session ended with error: ${readData.statusText || 'unknown error'}`);
      } else if (readData.status === 'killed' || readData.status === 'crashed') {
        writeLine(io.stderr, `  ❌ Session ended: ${readData.status}`);
      } else {
        writeLine(io.stdout, `  ✅ Session completed.`);
      }

      return entries.length > 0;
    } else {
      writeLine(io.stderr, `  ⚠️  Could not read session output (HTTP ${readRes.status}).`);
      writeLine(io.stderr, `     Try: ag read ${sessionId}`);
      return false;
    }
  } catch (e) {
    writeLine(io.stderr, `  ⚠️  Error reading output: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Stream session transcript/output to terminal using polling.
 *  @param maxIdleMs Maximum idle time before timing out (default 120s). Set to 90_000 for --yes mode.
 *  @returns true if output was received, false if timed out without output. */
/**
 * Issue #3887: Kill a session on the server when the CLI is interrupted.
 * Best-effort — swallows errors since the process is exiting anyway.
 */
export async function killSessionOnExit(baseUrl: string, sessionId: string, authToken: string | undefined): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    await fetch(`${baseUrl}/sessions/${sessionId}/kill`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Best-effort — process is exiting, network may be down
  }
}

export async function streamOutput(baseUrl: string, sessionId: string, authToken: string | undefined, io: CliIO, maxIdleMs: number = 120_000): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let lastLineCount = 0;
  let lastActivity = Date.now();
  let receivedAnyOutput = false;
  let accumulatedEntries: Array<{ text: string; role?: string; contentType?: string }> = [];

  writeLine(io.stdout);
  writeLine(io.stdout, '  📡 Streaming session output (Ctrl+C to stop)...');
  writeLine(io.stdout);

  // #3732: Increased from 5s to 15s — read endpoint may block waiting for CC output
  const FETCH_TIMEOUT_MS = 15_000;
  const MAX_CONSECUTIVE_ERRORS = 3;
  let consecutiveErrors = 0;

  while (Date.now() - lastActivity < maxIdleMs) {
    try {
      const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/read`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) {
        // Session might have ended
        if (res.status === 404) break;
        if (res.status === 429) {
          // Rate limit detected while streaming
          const body = await res.text().catch(() => res.statusText);
          writeLine(io.stderr);
          writeLine(io.stderr, '  ❌ Rate limit detected while streaming session output (HTTP 429).');
          if (body) writeLine(io.stderr, `    ${body.slice(0, 1000)}`);
          process.exitCode = 2;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const data = await res.json() as {
        messages?: Array<{ text: string; role?: string; contentType?: string }>;
        status?: string;
        statusText?: string | null;
      };

      // Reset error counter on successful fetch
      consecutiveErrors = 0;

      // #3368: Read endpoint returns `messages`, not `lines` or `transcript`
      const entries = data.messages || [];
      // #3758: Accumulate entries for rate-limit check in timeout path
      if (entries.length > accumulatedEntries.length) {
        accumulatedEntries = entries;
      }
      if (entries.length > lastLineCount) {
        const newEntries = entries.slice(lastLineCount);
        for (const entry of newEntries) {
          // Skip non-text content types (thinking, tool_use, tool_result, etc.)
          if (entry.contentType && entry.contentType !== 'text') continue;
          const prefix = entry.role === 'user' ? '  👤 ' : entry.role === 'assistant' ? '  🤖 ' : '  ';
          writeLine(io.stdout, `${prefix}${entry.text.slice(0, 500)}`);
        }
        lastLineCount = entries.length;
        lastActivity = Date.now();
        receivedAnyOutput = true;
      }

      // Check if session is done
      // #3773: Also break on idle when we've received output (session ran and completed back to idle)
      const isTerminal = data.status === 'completed' || data.status === 'error' || data.status === 'killed' || data.status === 'crashed';
      const isIdleAfterWork = data.status === 'idle' && receivedAnyOutput;
      if (isTerminal || isIdleAfterWork) {
        writeLine(io.stdout);
        if (data.status === 'error') {
          // Issue #3631: Detect rate-limit errors and show actionable advice
          const errorMessages = entries
            .slice(-5)  // Check last 5 messages for rate limit indicators
            .map(e => e.text)
            .filter(Boolean);
          const isRateLimited = errorMessages.some(t => isRateLimitError(t));

          if (isRateLimited) {
            writeLine(io.stderr, '  ❌ Rate limit hit — the Claude API quota is exhausted.');
            writeLine(io.stderr);
            writeLine(io.stderr, '  To fix this:');
            writeLine(io.stderr, '    1. Wait for the rate limit window to reset (check error message for timing)');
            writeLine(io.stderr, '    2. Use a different model:  ag run "..." --model <model>');
            writeLine(io.stderr, '    3. Use a different provider: export ANTHROPIC_API_KEY=<key-with-higher-limits>');
            writeLine(io.stderr);
            writeLine(io.stderr, '  Common model alternatives:');
            writeLine(io.stderr, '    claude-sonnet-4-6  (default, fast)');
            writeLine(io.stderr, '    claude-haiku-3-5   (cheaper, higher limits)');
            writeLine(io.stderr);
            // Signal rate limit via exit code 2
            receivedAnyOutput = true;  // Don't trigger --yes timeout message
            process.exitCode = 2;
          } else {
            writeLine(io.stderr, `  ❌ Session ended with error: ${data.statusText || 'unknown error'}`);
            writeLine(io.stderr);
            writeLine(io.stderr, '  If this is a rate limit, try:');
            writeLine(io.stderr, '    1. Waiting for the rate limit window to reset');
            writeLine(io.stderr, '    2. Using a different model: ag run "..." --model <model>');
            writeLine(io.stderr, `    3. Check transcript: ag read ${sessionId}`);
          }
        } else if (isIdleAfterWork) {
          writeLine(io.stdout, `  ✅ Session completed successfully.`);
        } else {
          writeLine(io.stdout, `  ✅ Session ended: ${data.statusText || data.status}`);
        }
        break;
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      // #3732: Retry on transient fetch errors instead of aborting immediately
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        writeLine(io.stderr, `  ⚠️  Stream fetch failed after ${MAX_CONSECUTIVE_ERRORS} attempts: ${getErrorMessage(e)}`);
        break;
      }
      // Transient error — retry after brief pause
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // #3758: Check for rate-limit in timeout path
  if (!receivedAnyOutput && Date.now() - lastActivity >= maxIdleMs) {
    // Check accumulated transcript for rate limit indicators
    const rateLimitTexts = accumulatedEntries
      .slice(-10)  // Check last 10 messages
      .map(e => e.text)
      .filter(Boolean);
    const hitRateLimit = rateLimitTexts.some(t => isRateLimitError(t));

    if (hitRateLimit) {
      writeLine(io.stderr);
      writeLine(io.stderr, '  ❌ Rate limit hit — the Claude API quota is exhausted.');
      writeLine(io.stderr);
      writeLine(io.stderr, '  To fix this:');
      writeLine(io.stderr, '    1. Wait for the rate limit window to reset (check error message for timing)');
      writeLine(io.stderr, '    2. Use a different model:  ag run "..." --model <model>');
      writeLine(io.stderr, '    3. Use a different provider: export ANTHROPIC_API_KEY=<key-with-higher-limits>');
      writeLine(io.stderr);
      process.exitCode = 2;
    } else {
      writeLine(io.stderr);
      writeLine(io.stderr, `  ⏱️  No output received within ${Math.round(maxIdleMs / 1000)}s idle timeout.`);
      writeLine(io.stderr, '  This may be caused by:');
      writeLine(io.stderr, '    • Claude API rate limit or quota exhaustion');
      writeLine(io.stderr, '    • Network connectivity issues');
      writeLine(io.stderr, '    • Session waiting for permission approval');
      writeLine(io.stderr);
      writeLine(io.stderr, '  To troubleshoot:');
      writeLine(io.stderr, '    1. Check rate limits: https://console.anthropic.com/settings/limits');
      writeLine(io.stderr, `    2. View session transcript: ag read ${sessionId}`);
      writeLine(io.stderr, '    3. Try a different model: ag run "..." --model <model>');
    }
  }

  // Return whether we received any output (for --yes timeout detection)
  return receivedAnyOutput;
}

export async function handleRun(args: string[], io: CliIO): Promise<number> {
  // #3358: Show run-specific help
  if (args.includes('--help') || args.includes('-h')) {
    writeLine(io.stdout);
    writeLine(io.stdout, '  ag run <prompt> [options]');
    writeLine(io.stdout);
    writeLine(io.stdout, '  Create a session, deliver a brief, and stream output.');
    writeLine(io.stdout);
    writeLine(io.stdout, '  Arguments:');
    writeLine(io.stdout, '    <prompt>              Task description for Claude');
    writeLine(io.stdout);
    writeLine(io.stdout, '  Options:');
    writeLine(io.stdout, '    --cwd <path>          Working directory (default: current directory)');
    writeLine(io.stdout, '    --port <number>       Server port override (default: 9100)');
    writeLine(io.stdout, '    --no-stream           Don\'t stream output; print status only');
    writeLine(io.stdout, '    --accept-permissions  Auto-approve tool permissions (-y)');
    writeLine(io.stdout, '    --timeout <sec>        Idle timeout in seconds (default: 300 with --yes, 120 without)');
    writeLine(io.stdout, '    --passthrough          Run session with all permissions bypassed');
    writeLine(io.stdout, '    --model <model>       Set Claude model');
    writeLine(io.stdout, '    --effort <level>      Set reasoning effort (low, medium, high, 0.0-1.0)');
    writeLine(io.stdout, '    -h, --help            Show this help message');
    writeLine(io.stdout);
    return 0;
  }

  // Extract prompt
  const brief = args.find((a) => !a.startsWith('-'));
  if (!brief) {
    writeLine(io.stderr, '  ❌ Missing prompt. Usage: ag run "Build a REST API" [--cwd /path]');
    writeLine(io.stderr, '  Run ag run --help for available options.');
    return 1;
  }

  // Extract --cwd
  const cwdIdx = args.indexOf('--cwd');
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? resolve(args[cwdIdx + 1]) : process.cwd();

  // Extract --port
  const portIdx = args.indexOf('--port');
  const portOverride = portIdx !== -1 ? parseIntSafe(args[portIdx + 1], 9100) : null;

  const modelIdx = args.indexOf('--model');
  const rawModel = modelIdx !== -1 && args[modelIdx + 1] ? args[modelIdx + 1] : undefined;
  const model = rawModel && !rawModel.startsWith('-') ? rawModel : undefined;
  if (modelIdx !== -1 && !model) {
    writeLine(io.stderr, '  \u274c --model requires a value');
    return 1;
  }
  let effort: string | undefined;
  const effortIdx = args.indexOf('--effort');
  if (effortIdx !== -1 && args[effortIdx + 1]) {
    const validated = validateEffort(args[effortIdx + 1]!);
    if (validated === null) {
      writeLine(io.stderr, '  \u274c Invalid --effort value.');
      return 1;
    }
    effort = validated;
  }

  const noStream = args.includes('--no-stream');
  const skipPrompts = args.includes('--yes');
  const acceptPerms = args.includes('--accept-permissions') || args.includes('-y') || args.includes('--passthrough');

  // Issue #3865: Configurable idle timeout (env: AEGIS_RUN_TIMEOUT, flag: --timeout <sec>)
  const timeoutFlagIdx = args.indexOf('--timeout');
  const timeoutFlag = timeoutFlagIdx !== -1 ? parseInt(args[timeoutFlagIdx + 1], 10) : NaN;
  const timeoutEnv = parseInt(process.env.AEGIS_RUN_TIMEOUT ?? '', 10);
  const cliTimeoutSec = (!isNaN(timeoutFlag) && timeoutFlag > 0) ? timeoutFlag
    : (!isNaN(timeoutEnv) && timeoutEnv > 0) ? timeoutEnv
    : null;

  writeLine(io.stdout, `  🚀 ag run: ${brief.slice(0, 60)}${brief.length > 60 ? '...' : ''}`);

  // Determine config path and base URL
  const configPath = defaultConfigPath();
  const existingConfig = await readConfigFile(configPath);
  const config = await loadConfig();
  const baseUrl = portOverride !== null
    ? deriveBaseUrl('127.0.0.1', portOverride)
    : getConfiguredBaseUrl(config);

  // Check if server is running
  let authToken = await resolveAuthToken() || config.authToken || config.clientAuthToken || undefined;
  let serverRunning = await isServerHealthy(baseUrl, authToken);

  if (!serverRunning) {
    if (!skipPrompts) writeLine(io.stdout, '  ⏳ Server not running — starting...');

    // Ensure config exists (creates proper key in keys.json via AuthManager)
    if (!existingConfig) {
      if (!skipPrompts) writeLine(io.stdout, '  ⏳ No config found — bootstrapping with defaults...');
      const generatedToken = await ensureConfig(configPath, config.stateDir, portOverride ?? undefined);
      if (generatedToken) authToken = generatedToken;
      if (!skipPrompts) {
        writeLine(io.stdout, `  ✅ Config created: ${configPath}`);
        writeLine(io.stdout, `  📊 Dashboard: ${baseUrl.replace("/v1", "")}`);
      }
    }

    // Issue #3759: Only start a new server if one isn't already running
    const serverDir = join(import.meta.dirname || __dirname, '..');
    const alreadyRunning = await isServerHealthy(baseUrl, authToken);
    if (!alreadyRunning) {
      startServer(serverDir, portOverride ?? undefined);

      // Wait for server
      if (!skipPrompts) writeLine(io.stdout, '  ⏳ Waiting for server...');
      const started = await waitForServer(baseUrl, authToken, 15_000);
      if (!started) {
        // Issue #3067: Race condition — an existing Aegis server may be on the port
        // but was in a crash loop when we first checked. Retry health check once
        // more before giving up — the existing server may have recovered.
        if (!skipPrompts) writeLine(io.stdout, '  ⏳ Retrying health check (existing server may have recovered)...');
        if (await isServerHealthy(baseUrl, authToken)) {
          if (!skipPrompts) writeLine(io.stdout, '  ✅ Connected to existing server');
        } else {
          writeLine(io.stderr, '  ❌ Server failed to start within 15 seconds.');
          writeLine(io.stderr, '     Try starting manually: ag');
          return 1;
        }
      } else if (!skipPrompts) {
        writeLine(io.stdout, '  ✅ Server started');
      }
    } else if (!skipPrompts) {
      writeLine(io.stdout, '  ✅ Connected to existing server');
    }
  }

  // Issue #3306: Preflight auth check before creating a session.
  // Prevents orphaned server sessions when the CLI token is invalid.
  if (serverRunning && authToken) {
    const authCheck = await verifyAuth(baseUrl, authToken);
    if (!authCheck.ok) {
      writeLine(io.stderr, '');
      writeLine(io.stderr, '  ❌ Unauthorized — the server rejected the auth token.');
      writeLine(io.stderr, '');
      writeLine(io.stderr, '  To fix this:');
      writeLine(io.stderr, '    1. Run `ag init` to create a new API key and config');
      writeLine(io.stderr, '    2. Or set AEGIS_AUTH_TOKEN=<your-key> in your environment');
      writeLine(io.stderr, '');
      return 1;
    }
  }

  // #3350 + #3670: Preflight check — verify Claude Code is available and authenticated.
  const claudeCheck = await checkClaudeInstalled();
  if (!claudeCheck.installed) {
    // Claude CLI not on PATH — check if ACP can work with just ANTHROPIC_API_KEY
    if (!hasAnthropicCredentials()) {
      writeLine(io.stderr, '');
      writeLine(io.stderr, '  ❌ Claude Code CLI not found and no ANTHROPIC_API_KEY set.');
      writeLine(io.stderr, '');
      writeLine(io.stderr, '  Aegis needs one of the following to create sessions:');
      writeLine(io.stderr, '    1. Claude Code CLI installed and authenticated (run: ag init)');
      writeLine(io.stderr, '    2. ANTHROPIC_API_KEY environment variable set');
      writeLine(io.stderr, '');
      writeLine(io.stderr, '  Quick fix:');
      writeLine(io.stderr, '    curl -fsSL https://claude.ai/install.sh | bash');
      writeLine(io.stderr, '    Or: export ANTHROPIC_API_KEY=<your-key>');
      writeLine(io.stderr, '');
      return 1;
    }
    // ANTHROPIC_API_KEY is set — ACP can authenticate without the CLI. Proceed.
  } else {
    // Claude CLI found — verify it is authenticated
    try {
      const { execFile } = await import('node:child_process');
      const authCheck = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        execFile('claude', ['-p', '/version'], { timeout: 5000 }, (err, stdout, stderr) => {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: err ? (err as any).code ?? 1 : 0 });
        });
      });
      if (authCheck.stderr.includes('Not logged in') || authCheck.stderr.includes('Please run /login') || authCheck.code === 1) {
        writeLine(io.stderr, '');
        writeLine(io.stderr, '  ❌ Claude Code is not authenticated.');
        writeLine(io.stderr, '');
        writeLine(io.stderr, '  Aegis requires Claude Code to be logged in before creating sessions.');
        writeLine(io.stderr, '');
        writeLine(io.stderr, '  To fix this:');
        writeLine(io.stderr, '    1. Run: claude');
        writeLine(io.stderr, '    2. Follow the login prompts, or');
        writeLine(io.stderr, '    3. Set ANTHROPIC_API_KEY=<your-key> in your environment');
        writeLine(io.stderr, '');
        return 1;
      }
    } catch {
      // Auth check failed — proceed anyway, session creation will surface the real error
    }
  }

  // Create session
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let sessionId: string;
  try {
    // Session creation timeout — configurable via AEGIS_SESSION_CREATION_TIMEOUT_MS (ms)
    const sessionCreationTimeoutMs = parseInt(process.env.AEGIS_SESSION_CREATION_TIMEOUT_MS ?? '', 10) || 120_000;
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      signal: AbortSignal.timeout(sessionCreationTimeoutMs),  // Issue #3243: session creation is now fast (prompt delivery is async)
      headers,
      body: JSON.stringify({
        workDir: cwd,
        prompt: brief,
        name: generateSessionName(brief),
        model,
        effort,
        ...(acceptPerms ? { permissionMode: 'bypassPermissions' } : {}),
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

      if (res.status === 429) {
        // Rate limit from upstream provider or ACP; attempt to extract message
        const body = await res.text().catch(() => res.statusText);
        writeLine(io.stderr, "");
        writeLine(io.stderr, "  ❌ Rate limit detected while creating session (HTTP 429).");
        if (body) {
          writeLine(io.stderr, "  Response:");
          writeLine(io.stderr, `    ${body.slice(0, 1000)}`);
          writeLine(io.stderr, "");
        }
        writeLine(io.stderr, "  This usually means the Claude/LLM provider quota is exhausted.");
        writeLine(io.stderr, "  Suggestions:");
        writeLine(io.stderr, "    • Wait for the rate limit window to reset");
        writeLine(io.stderr, "    • Use a different model: ag run "..." --model <model>");
        writeLine(io.stderr, "    • Use a different provider / API key with higher limits");
        process.exitCode = 2;
        return 2;
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
      writeLine(io.stdout, '  ⏳ Delivering prompt (agent starting up)...');
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

  // Issue #3887: Register signal handlers to kill session on CLI exit
  let signalReceived = false;
  const onSignal = (sig: string) => {
    if (signalReceived) return; // Prevent double-fire
    signalReceived = true;
    writeLine(io.stderr, `\n  ⏔ Received ${sig} — cleaning up session ${sessionId.slice(0, 8)}...`);
    void killSessionOnExit(baseUrl, sessionId, authToken).finally(() => process.exit(130));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  // Dashboard URL
  const dashboardUrl = baseUrl.replace('/v1', '');
  writeLine(io.stdout, `  📊 Dashboard: ${dashboardUrl}`);

  if (noStream) {
    // Issue #3696: Instead of just printing curl commands and exiting,
    // poll until session completes then print all output.
    const pollTimeoutMs = 300_000; // 5 min max wait
    const hadOutput = await pollUntilComplete(baseUrl, sessionId, authToken, io, pollTimeoutMs);
    // Issue #3887: Remove signal handlers on normal exit
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    // If pollUntilComplete reported no output, surface a non-zero exit code
    if (!hadOutput) {
      // If the poll detected a rate-limit it may have set process.exitCode=2 upstream.
      return process.exitCode === 2 ? 2 : 1;
    }
    return 0;
  }

  // Stream output
  // Issue #3865: Configurable idle timeout. Default: 300s (--yes) / 120s (interactive).
  // Was 90s/120s which killed real work (CC needs time for git analysis, large reads, etc.)
  const defaultTimeoutMs = skipPrompts ? 300_000 : 120_000;
  const streamTimeoutMs = cliTimeoutSec !== null ? cliTimeoutSec * 1000 : defaultTimeoutMs;
  const receivedOutput = await streamOutput(baseUrl, sessionId, authToken, io, streamTimeoutMs);

  // Issue #3887: Remove signal handlers on normal exit
  process.removeListener('SIGTERM', onSignal);
  process.removeListener('SIGINT', onSignal);

  // Issue #3732: If timed out without output, show actionable error (all modes)
  if (!receivedOutput) {
    writeLine(io.stderr);
    writeLine(io.stderr, `  ⚠️  No output received within ${Math.round(streamTimeoutMs / 1000)} seconds.`);
    writeLine(io.stderr, '  This usually means Claude Code could not start or is not responding.');
    writeLine(io.stderr);
    writeLine(io.stderr, '  Possible causes:');
    writeLine(io.stderr, '    • Claude Code is not installed or not in PATH');
    writeLine(io.stderr, '    • Claude Code is not authenticated (run: claude)');
    writeLine(io.stderr, '    • The Aegis server cannot communicate with Claude Code');
    writeLine(io.stderr);
    writeLine(io.stderr, '  Troubleshoot:');
    writeLine(io.stderr, `    Session: ag read ${sessionId}`);
    writeLine(io.stderr, `    Logs:    curl ${baseUrl}/v1/sessions/${sessionId}/health`);
    return 1;
  }

  return 0;
}

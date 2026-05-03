#!/usr/bin/env node
/**
 * cli.ts — CLI entry point for Aegis.
 *
 * `ag` is the primary CLI command and `aegis` remains an alias. Both start the
 * server with sensible defaults and support interactive project bootstrap via
 * `ag init`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveBaseUrl, getConfiguredBaseUrl } from './base-url.js';
import { loadConfig } from './config.js';
import { runDoctorCommand } from './doctor.js';
import { handleInit, findStarterTemplateFiles, handleStarterTemplateDoctor } from './commands/init.js';
import { handleLogin } from './commands/login.js';
import { handleLogout } from './commands/logout.js';
import { handleWhoami } from './commands/whoami.js';
import { getErrorMessage, parseIntSafe } from './validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
/** Current aegis version read from package.json at startup. */
const VERSION: string = pkg.version;

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

const defaultCliIO: CliIO = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
};

/** Check whether a required external dependency can be executed. */
function checkDependency(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { /* command not found or exited non-zero */
    return false;
  }
}

/** Parse tmux -V output and enforce minimum supported version. */
function checkTmuxVersion(minMajor: number = 3, minMinor: number = 2): { ok: boolean; version: string | null } {
  try {
    const out = execFileSync('tmux', ['-V'], { encoding: 'utf-8', timeout: 5000 }).trim();
    const m = out.match(/tmux\s+(\d+)\.(\d+)/i);
    if (!m) return { ok: false, version: null };
    const major = parseInt(m[1]!, 10);
    const minor = parseInt(m[2]!, 10);
    const ok = major > minMajor || (major === minMajor && minor >= minMinor);
    return { ok, version: `${major}.${minor}` };
  } catch {
    return { ok: false, version: null };
  }
}

function write(stream: NodeJS.WritableStream, text: string): void {
  stream.write(text);
}

function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}

/** Render the startup banner shown when launching the HTTP server. */
function printBanner(io: CliIO, _port: number): void {
  write(io.stdout, `
  ┌─────────────────────────────────────────┐
  │          ⚡ Aegis v${VERSION}               │
  │    Claude Code Session Bridge            │
  └─────────────────────────────────────────┘
  `);
}

async function resolveAuthToken(): Promise<string> {
  const envToken = process.env.AEGIS_AUTH_TOKEN || process.env.AEGIS_TOKEN;
  if (envToken) return envToken;

  const config = await loadConfig();
  if (config.clientAuthToken) return config.clientAuthToken;
  if (config.authToken) return config.authToken;

  const legacyPaths = [
    join(homedir(), '.aegis', 'config.json'),
    join(homedir(), '.manus', 'config.json'),
  ];

  for (const configPath of legacyPaths) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { authToken?: string };
      if (parsed.authToken) return parsed.authToken;
    } catch { /* file not found or invalid JSON — skip */ }
  }

  return '';
}

async function handleDoctor(args: string[], io: CliIO): Promise<number> {
  try {
    if (args.length > 0) {
      return runDoctorCommand(args);
    }

    const filesToCheck = await findStarterTemplateFiles();
    if (filesToCheck.length > 0) {
      return handleStarterTemplateDoctor(io, filesToCheck);
    }

    return runDoctorCommand(args);
  } catch (error) {
    writeLine(io.stderr, `  ❌ Failed to run doctor: ${getErrorMessage(error)}`);
    return 1;
  }
}

/** Issue #5 stretch: create a session from CLI. */
async function handleCreate(args: string[], io: CliIO): Promise<number> {
  let brief = '';
  let cwd = process.cwd();
  let portOverride: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = args[++i]!;
    } else if (args[i] === '--port' && args[i + 1]) {
      portOverride = parseIntSafe(args[++i], 9100);
    } else if (!args[i].startsWith('-')) {
      brief = args[i];
    }
  }

  if (!brief) {
    writeLine(io.stderr, '  ❌ Missing brief. Usage: ag create "Build a login page"');
    return 1;
  }

  const config = await loadConfig();
  const baseUrl = portOverride === null
    ? getConfiguredBaseUrl(config)
    : deriveBaseUrl('127.0.0.1', portOverride);
  const sessionName = `cc-${brief.slice(0, 20).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
  const authToken = await resolveAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let sessionId: string;
  try {
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workDir: cwd, name: sessionName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      writeLine(io.stderr, `  ❌ Failed to create session: ${(err as { error?: string }).error || res.statusText}`);
      return 1;
    }

    const session = await res.json() as { id: string; windowName: string };
    sessionId = session.id;
    writeLine(io.stdout, `  ✅ Session created: ${session.windowName}`);
    writeLine(io.stdout, `     ID: ${sessionId}`);
  } catch (e: unknown) {
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === 'ECONNREFUSED') {
      writeLine(io.stderr, `  ❌ Cannot connect to Aegis at ${baseUrl}.`);
      writeLine(io.stderr, '     Start the server first: ag');
    } else {
      writeLine(io.stderr, `  ❌ ${getErrorMessage(e)}`);
    }
    return 1;
  }

  try {
    const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: brief }),
    });

    const result = await res.json() as { delivered?: boolean; attempts?: number };
    if (result.delivered) {
      writeLine(io.stdout, `  ✅ Brief delivered (attempt ${result.attempts})`);
    } else {
      writeLine(io.stdout, `  ⚠️  Brief sent but delivery not confirmed after ${result.attempts} attempts`);
    }
  } catch (e: unknown) {
    writeLine(io.stderr, `  ⚠️  Failed to send brief: ${getErrorMessage(e)}`);
  }

  writeLine(io.stdout);
  writeLine(io.stdout, '  Next steps:');
  writeLine(io.stdout, `    Status:   curl ${baseUrl}/v1/sessions/${sessionId}/health`);
  writeLine(io.stdout, `    Read:     curl ${baseUrl}/v1/sessions/${sessionId}/read`);
  writeLine(io.stdout, `    Kill:     curl -X DELETE ${baseUrl}/v1/sessions/${sessionId}`);
  return 0;
}

function printHelp(io: CliIO): void {
  write(io.stdout, `
  ag — Claude Code session bridge (alias: aegis)

  Usage:
    ag                     Start the server (port 9100)
    ag init                Bootstrap .aegis/config.yaml
    ag init --yes          Non-interactive bootstrap for CI
    ag init --list-templates
    ag init --from-template code-reviewer
    ag doctor              Validate starter templates here or run local diagnostics
    ag "brief"             Create a session and send brief (shorthand)
    ag --port 3000         Custom port
    ag create "brief"      Create a session and send brief
    ag mcp                 Start MCP server (stdio transport)
    ag --help              Show this help

  Init:
    ag init
    ag init --yes
    ag init --list-templates
    ag init --from-template docs-writer

  Create:
    ag create "Build a login page" --cwd /path/to/project
    ag create "Fix the tests"      (uses current directory)

  Doctor:
    ag doctor              Validate starter templates here, otherwise run local diagnostics
    ag doctor --port 3000  Check a custom API port
    ag doctor --json       Emit machine-readable diagnostics

  MCP server:
    ag mcp                 Start MCP stdio server
    ag mcp --port 3000     Custom Aegis API port
    claude mcp add aegis -- ag mcp

  Auth (OAuth2 device flow):
    ag login               Authenticate via your IdP (requires OIDC config)
    ag logout              Revoke tokens and clear credentials
    ag logout --all        Clear credentials for all servers
    ag whoami              Show current identity and token status

  Environment variables:
    AEGIS_BASE_URL                 Preferred API base URL for hooks + CLI
    AEGIS_PORT                     Server port (default: 9100)
    AEGIS_HOST                     Server host (default: 127.0.0.1)
    AEGIS_AUTH_TOKEN               Bearer token for API auth
    AEGIS_TMUX_SESSION             tmux session name (default: aegis)
    AEGIS_STATE_DIR                State directory (default: ~/.aegis)
    AEGIS_DASHBOARD_ENABLED        Serve dashboard assets (default: true)
    AEGIS_TG_TOKEN                 Telegram bot token
    AEGIS_TG_GROUP                 Telegram group chat ID
    AEGIS_TG_ALLOWED_USERS         Allowed Telegram user IDs (comma-separated)
    AEGIS_WEBHOOKS                 Webhook URLs (comma-separated)
    AEGIS_OIDC_ISSUER              OIDC issuer URL (for ag login)
    AEGIS_OIDC_CLIENT_ID           OIDC client ID (for ag login)

  API:
    POST /v1/sessions             Create a session
    GET  /v1/sessions             List sessions
    GET  /v1/sessions/:id         Get session
    POST /v1/sessions/:id/send    Send message
    GET  /v1/sessions/:id/read    Read messages
    GET  /v1/sessions/:id/health  Health check
    DEL  /v1/sessions/:id         Kill session
    GET  /v1/health               Server health

  Docs: https://github.com/OneStepAt4time/aegis
  `);
}

/** Main CLI entry point that dispatches subcommands and bootstraps the server. */
export async function runCli(argv: string[] = process.argv.slice(2), io: CliIO = defaultCliIO): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp(io);
    return 0;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    writeLine(io.stdout, `ag v${VERSION}`);
    return 0;
  }

  if (argv[0] === 'mcp') {
    const mcpArgs = argv.slice(1);
    const portIdx = mcpArgs.indexOf('--port');
    const baseUrl = portIdx !== -1 && mcpArgs[portIdx + 1]
      ? deriveBaseUrl('127.0.0.1', parseIntSafe(mcpArgs[portIdx + 1], 9100))
      : getConfiguredBaseUrl(await loadConfig());
    const mcpAuth = process.env.AEGIS_AUTH_TOKEN || process.env.AEGIS_TOKEN || await resolveAuthToken();
    const { startMcpServer } = await import('./mcp-server.js');
    await startMcpServer(baseUrl, mcpAuth);
    return 0;
  }

  if (argv[0] === 'init') {
    return handleInit(argv.slice(1), io);
  }

  if (argv[0] === 'doctor') {
    return handleDoctor(argv.slice(1), io);
  }

  if (argv[0] === 'create') {
    return handleCreate(argv.slice(1), io);
  }

  if (argv[0] === 'login') {
    return handleLogin(argv.slice(1), io);
  }

  if (argv[0] === 'logout') {
    return handleLogout(argv.slice(1), io);
  }

  if (argv[0] === 'whoami') {
    return handleWhoami(argv.slice(1), io);

  }

  if (argv.length === 1 && !argv[0].startsWith('-')) {
    return handleCreate(argv, io);
  }

  const portIdx = argv.indexOf('--port');
  if (portIdx !== -1 && argv[portIdx + 1]) {
    process.env.AEGIS_PORT = argv[portIdx + 1];
  }

  const hasTmux = checkDependency('tmux', ['-V']);
  const hasClaude = checkDependency('claude', ['--version']);
  const tmuxVersion = hasTmux ? checkTmuxVersion(3, 2) : { ok: false, version: null };

  if (!hasTmux) {
    write(io.stderr, `
  ❌ tmux not found.

  Install tmux:
    Ubuntu/Debian:  sudo apt install tmux
    macOS:          brew install tmux
    Windows:        winget install psmux
    `);
    return 1;
  }

  if (!tmuxVersion.ok) {
    write(io.stderr, `
  ❌ Unsupported tmux version${tmuxVersion.version ? ` (${tmuxVersion.version})` : ''}.

  Aegis requires tmux/psmux 3.2 or newer.
  `);
    return 1;
  }

  if (!hasClaude) {
    write(io.stderr, `
  ⚠️  Claude Code CLI not found.

  Install Claude Code:
    curl -fsSL https://claude.ai/install.sh | bash

  Sessions will fail to start without the 'claude' command.
    `);
  }

  const config = await loadConfig();
  printBanner(io, config.port);

  writeLine(io.stdout, '  Dependencies:');
  writeLine(io.stdout, `    tmux:   ${hasTmux ? '✅' : '❌'}`);
  writeLine(io.stdout, `    claude: ${hasClaude ? '✅' : '❌'}`);
  writeLine(io.stdout);

  await import('./server.js');
  return 0;
}

const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  void runCli().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error('Failed to start Aegis:', error);
    process.exitCode = 1;
  });
}

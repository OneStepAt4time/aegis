#!/usr/bin/env node
import { StructuredLogger } from './logger.js';
const log = new StructuredLogger();

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
import { handleAuthMigrate } from './commands/auth.js';
import { readAuthTokenFile } from './utils/auth-token-path.js';
import { handleLogin } from './commands/login.js';
import { handleLogout } from './commands/logout.js';
import { handleWhoami } from './commands/whoami.js';
import { handleRun } from './commands/run.js';
import { handleList } from './commands/list.js';
import { handleMeta } from './commands/meta.js';
import { handleSend } from './commands/send.js';
import { handleUpdate } from './commands/update.js';
import { handleRead } from './commands/read.js';
import { handleKill } from './commands/kill.js';
import { handleApprove } from './commands/approve.js';
import { handleReject } from './commands/reject.js';
import { handleStatus } from './commands/status.js';
import { handleTail } from './commands/tail.js';
import {
  AcpBinaryResolutionError,
  resolveClaudeAgentAcpBinary,
} from './services/acp/binary-resolver.js';
import { getErrorMessage, parseIntSafe, validateEffort } from './validation.js';
import { generateSessionName } from './utils/session-name.js';
import { setJsonLogsEnabled } from './logger.js';
import { CliIO, write, writeLine, resolveAuthToken } from './cli-http.js';
import { handleCreate } from './commands/create.js';
export type { CliIO };


const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
/** Current aegis version read from package.json at startup. */
const VERSION: string = pkg.version;


const defaultCliIO: CliIO = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
};



/** Render the startup banner shown when launching the HTTP server. */
export function printBanner(io: CliIO, port: number, host: string): void {
  write(io.stdout, `
  ┌─────────────────────────────────────────┐
  │          ⚡ Aegis v${VERSION}               │
  │    Claude Code Session Bridge            │
  └─────────────────────────────────────────┘
  `);
  // Issue #3500 (F22): human-friendly startup hint
  writeLine(io.stdout, `  → Dashboard: http://${host}:${port}/dashboard/`);
  writeLine(io.stdout, `  → Try: ag create 'Build a hello world'`);
  writeLine(io.stdout, `  → Telegram: set AEGIS_TG_TOKEN + AEGIS_TG_GROUP (see docs/guides/phone-approvals.md)`);
  writeLine(io.stdout);
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

function printHelp(io: CliIO): void {
  const showOidc = process.env.AEGIS_FEATURE_OIDC === '1';
  const authBlock = showOidc ? `
  Auth (OAuth2 device flow):
    ag login               Authenticate via your IdP (requires OIDC config)
    ag logout              Revoke tokens and clear credentials
    ag logout --all        Clear credentials for all servers
    ag whoami              Show current identity and token status

` : '';
  write(io.stdout, `
  ag — Claude Code session bridge (alias: aegis)

  Usage:
    ag                     Start the server (port 9100)
    ag init                Bootstrap + start server + open browser (default)
    ag init --no-start     Bootstrap config only, don't start server
    ag init --yes          Non-interactive bootstrap for CI
    ag init --force        Overwrite existing config (use with caution)
    ag init --no-open      Start server but skip browser open
    ag run "prompt"        Zero-to-session in one command
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
    ag init --no-start
    ag init --yes
    ag init --list-templates
    ag init --from-template docs-writer

  Create:
    ag create "Build a login page" --cwd /path/to/project
    ag create "Fix the tests"      (uses current directory)
    ag create "..." --passthrough   Bypass all permissions
    ag create "..." --session-id abc  Send to existing session
    --model <model>       Set Claude model
    --effort <level>      Set reasoning effort (low, medium, high, 0.0-1.0)

  Doctor:
    ag doctor              Validate starter templates here, otherwise run local diagnostics
    ag doctor --port 3000  Check a custom API port
    ag doctor --json       Emit machine-readable diagnostics

  MCP server:
    ag mcp                 Start MCP stdio server
    ag mcp --port 3000     Custom Aegis API port
    claude mcp add aegis -- ag mcp

  Sessions:
    ag list                 List active sessions
    ag list --status active  Filter by status
    ag read <id>            Read session output
    ag tail <id>            Follow session output in real-time
    ag send <id> "msg"      Send message to a running session
    ag kill <id>            Terminate a session
    ag approve <id>         Approve pending tool-call permission
    ag reject <id>          Reject pending tool-call permission
    ag status               Show server health + session summary

  Update:
    ag update               Check for and apply self-update
    ag update --check       Only check, no update (exit 1 if available)
    ag update --yes         Skip confirmation prompt
    ag update --dry-run      Show what would happen without updating
    ag meta <id> [--set key=val] [--delete key]  Per-session metadata KV store
${authBlock}  Flags:
    --json-logs           Emit structured JSON logs (default: quiet mode)

  Environment variables:
    AEGIS_BASE_URL                 Preferred API base URL for hooks + CLI
    AEGIS_PORT                     Server port (default: 9100)
    AEGIS_HOST                     Server host (default: 127.0.0.1)
    AEGIS_AUTH_TOKEN               Bearer token for API auth
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
    POST /v1/sessions/:id/permission/approve  Approve permission
    POST /v1/sessions/:id/permission/reject   Reject permission
    GET  /v1/health               Server health

  Docs: https://github.com/OneStepAt4time/aegis
  `);
}

/** Main CLI entry point that dispatches subcommands and bootstraps the server. */
export async function runCli(argv: string[] = process.argv.slice(2), io: CliIO = defaultCliIO): Promise<number> {
  // Issue #3796: Only show generic help if no subcommand is provided.
  // Subcommands like 'run' handle their own --help with command-specific flags.
  const knownCommands = ['mcp', 'init', 'doctor', 'create', 'login', 'logout', 'whoami', 'run', 'list', 'read', 'status', 'kill', 'approve', 'reject', 'sessions', 'stop', 'send', 'meta', 'update', 'version', 'setup'];
  const hasKnownCommand = argv.length > 0 && knownCommands.includes(argv[0]);
  if ((argv.includes('--help') || argv.includes('-h')) && !hasKnownCommand) {
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

  if (argv[0] === 'run') {
    return handleRun(argv.slice(1), io);
  }

  if (argv[0] === 'list') {
    return handleList(argv.slice(1), io);
  }

  if (argv[0] === 'read') {
    return handleRead(argv.slice(1), io);
  }

  if (argv[0] === 'send') {
    return handleSend(argv.slice(1), io);
  }

  if (argv[0] === 'kill') {
    return handleKill(argv.slice(1), io);
  }

  if (argv[0] === 'status') {
    return handleStatus(argv.slice(1), io);
  }

  if (argv[0] === 'auth') {
    const sub = argv[1];
    if (sub === 'migrate') {
      return handleAuthMigrate(argv.slice(2), io);
    }
    writeLine(io.stderr, '  Unknown auth subcommand. Usage: ag auth migrate');
    return 1;
  }

  if (argv[0] === 'approve') {
    return handleApprove(argv.slice(1), io);
  }

  if (argv[0] === 'reject') {
    return handleReject(argv.slice(1), io);
  }


  if (argv[0] === 'tail') {
    return handleTail(argv.slice(1), io);
  }

  if (argv[0] === 'meta') {
    return handleMeta(argv.slice(1), io);
  }
  if (argv[0] === 'update') {
    return handleUpdate(argv.slice(1), io);
  }
  // typos (e.g. "ag status", "ag health") rather than intentional prompts.
  // Multi-word args or quoted strings are treated as prompts (backward compat).
  if (argv.length === 1 && !argv[0].startsWith('-') && !argv[0].includes(' ')) {
    writeLine(io.stderr, `Unknown command: "${argv[0]}". Run ag --help for usage.`);
    return 1;
  }

  // Multi-word bare args or explicit create: treat as prompt
  if (argv.length === 1 && !argv[0].startsWith('-')) {
    return handleCreate(argv, io);
  }

  // Issue #3500: --json-logs flag to restore structured JSON log output
  const jsonLogs = argv.includes('--json-logs');
  setJsonLogsEnabled(jsonLogs);

  const portIdx = argv.indexOf('--port');
  if (portIdx !== -1 && argv[portIdx + 1]) {
    process.env.AEGIS_PORT = argv[portIdx + 1];
  }

  let acpRuntime: { ok: boolean; label: string };
  try {
    const resolved = resolveClaudeAgentAcpBinary();
    acpRuntime = { ok: true, label: resolved.source === 'AEGIS_ACP_BIN' ? `acp ✅ (${resolved.command})` : 'acp ✅' };
  } catch (error) {
    const message = error instanceof AcpBinaryResolutionError ? error.message : getErrorMessage(error);
    write(io.stderr, `
  ❌ ACP runtime not found.

  ${message}
    `);
    return 1;
  }

  let hasClaude: boolean;
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 5000 });
    hasClaude = true;
  } catch {
    hasClaude = false;
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
  printBanner(io, config.port, config.host);

  writeLine(io.stdout, '  Dependencies:');
  writeLine(io.stdout, `    runtime: ${acpRuntime.label}`);
  writeLine(io.stdout, `    claude: ${hasClaude ? '✅' : '❌'}`);
  writeLine(io.stdout);
  const { main } = await import('./server.js');
  main().catch((err) => { log.error({ component: 'server', operation: 'startup_failed', attributes: { error: String(err) } }); process.exit(1); });
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
    log.error({ component: 'cli', operation: 'startFailed', attributes: { error: String(error) } });
    process.exitCode = 1;
  });
}

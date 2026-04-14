#!/usr/bin/env node
/**
 * cli.ts — CLI entry point for Aegis.
 *
 * `npx @onestepat4time/aegis` or `aegis` starts the server with sensible defaults.
 * Auto-detects tmux and claude CLI, prints helpful startup message.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseIntSafe, getErrorMessage } from './validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
/** Current aegis version read from package.json at startup. */
const VERSION: string = pkg.version;

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
function checkTmuxVersion(minMajor: number = 3, minMinor: number = 3): { ok: boolean; version: string | null } {
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

/** Render the startup banner shown when launching the HTTP server. */
function printBanner(_port: number): void {
  console.log(`
  ┌─────────────────────────────────────────┐
  │          ⚡ Aegis v${VERSION}               │
  │    Claude Code Session Bridge            │
  └─────────────────────────────────────────┘
  `);
}

/** Resolve auth token for CLI commands.
 *  Priority: AEGIS_AUTH_TOKEN env var > authToken in ~/.aegis/config.json > legacy ~/.manus/config.json.
 *  Returns empty string if no token found (server may not require auth). */
function resolveAuthToken(): string {
  const envToken = process.env.AEGIS_AUTH_TOKEN;
  if (envToken) return envToken;

  const configPaths = [
    join(homedir(), '.aegis', 'config.json'),
    join(homedir(), '.manus', 'config.json'),
  ];

  for (const configPath of configPaths) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { authToken?: string };
      if (parsed.authToken) return parsed.authToken;
    } catch { /* file not found or invalid JSON — skip */ }
  }

  return '';
}

/** Issue #5 stretch: create a session from CLI. */
async function handleCreate(args: string[]): Promise<void> {
  // Parse brief text (first non-flag argument)
  let brief = '';
  let cwd = process.cwd();
  let port = parseIntSafe(process.env.AEGIS_PORT, 9100);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseIntSafe(args[++i], 9100);
    } else if (!args[i].startsWith('-')) {
      brief = args[i];
    }
  }

  if (!brief) {
    console.error('  ❌ Missing brief. Usage: aegis create "Build a login page"');
    process.exit(1);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const sessionName = `cc-${brief.slice(0, 20).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
  const authToken = resolveAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  // Create session
  let sessionId: string;
  try {
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workDir: cwd, name: sessionName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.error(`  ❌ Failed to create session: ${(err as { error?: string }).error || res.statusText}`);
      process.exit(1);
    }

    const session = await res.json() as { id: string; windowName: string };
    sessionId = session.id;
    console.log(`  ✅ Session created: ${session.windowName}`);
    console.log(`     ID: ${sessionId}`);
  } catch (e: unknown) {
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === 'ECONNREFUSED') {
      console.error(`  ❌ Cannot connect to Aegis on port ${port}.`);
      console.error(`     Start the server first: aegis`);
    } else {
      console.error(`  ❌ ${getErrorMessage(e)}`);
    }
    process.exit(1);
  }

  // Send brief
  try {
    const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: brief }),
    });

    const result = await res.json() as { delivered?: boolean; attempts?: number };
    if (result.delivered) {
      console.log(`  ✅ Brief delivered (attempt ${result.attempts})`);
    } else {
      console.log(`  ⚠️  Brief sent but delivery not confirmed after ${result.attempts} attempts`);
    }
  } catch (e: unknown) {
    console.error(`  ⚠️  Failed to send brief: ${getErrorMessage(e)}`);
  }

  // Print next steps
  console.log('');
  console.log('  Next steps:');
  console.log(`    Status:   curl ${baseUrl}/v1/sessions/${sessionId}/health`);
  console.log(`    Read:     curl ${baseUrl}/v1/sessions/${sessionId}/read`);
  console.log(`    Kill:     curl -X DELETE ${baseUrl}/v1/sessions/${sessionId}`);
}

/** Main CLI entry point that dispatches subcommands and bootstraps the server. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  aegis — Claude Code session bridge

  Usage:
    aegis                  Start the server (port 9100)
    aegis "brief"          Create a session and send brief (shorthand)
    aegis --port 3000      Custom port
    aegis create "brief"   Create a session and send brief
    aegis mcp              Start MCP server (stdio transport)
    aegis --help           Show this help

  Create:
    aegis create "Build a login page" --cwd /path/to/project
    aegis create "Fix the tests"      (uses current directory)

  MCP server:
    aegis mcp              Start MCP stdio server
    aegis mcp --port 3000  Custom Aegis API port
    claude mcp add aegis -- npx @onestepat4time/aegis mcp

  Environment variables:
    AEGIS_PORT                    Server port (default: 9100)
    AEGIS_HOST                    Server host (default: 127.0.0.1)
    AEGIS_AUTH_TOKEN              Bearer token for API auth
    AEGIS_TMUX_SESSION            tmux session name (default: aegis)
    AEGIS_STATE_DIR               State directory (default: ~/.aegis)
    AEGIS_TG_TOKEN                Telegram bot token
    AEGIS_TG_GROUP                Telegram group chat ID
    AEGIS_TG_ALLOWED_USERS        Allowed Telegram user IDs (comma-separated)
    AEGIS_WEBHOOKS                Webhook URLs (comma-separated)

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
    process.exit(0);
  }

  // Version
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`aegis v${VERSION}`);
    process.exit(0);
  }

  // Subcommand: mcp
  if (args[0] === 'mcp') {
    const mcpArgs = args.slice(1);
    let mcpPort = parseIntSafe(process.env.AEGIS_PORT, 9100);
    const mcpPortIdx = mcpArgs.indexOf('--port');
    if (mcpPortIdx !== -1 && mcpArgs[mcpPortIdx + 1]) {
      mcpPort = parseIntSafe(mcpArgs[mcpPortIdx + 1], 9100);
    }
    const mcpAuth = process.env.AEGIS_AUTH_TOKEN || process.env.AEGIS_TOKEN;
    const { startMcpServer } = await import('./mcp-server.js');
    await startMcpServer(mcpPort, mcpAuth);
    return; // stdio server runs until stdin closes
  }

  // Subcommand: create
  if (args[0] === 'create') {
    await handleCreate(args.slice(1));
    process.exit(0);
  }

  // Shorthand: single non-flag, non-subcommand arg = brief for session creation
  if (args.length === 1 && !args[0].startsWith('-')) {
    await handleCreate(args);
    process.exit(0);
  }

  // Port override from CLI
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    process.env.AEGIS_PORT = args[portIdx + 1];
  }

  // Check dependencies
  const hasTmux = checkDependency('tmux', ['-V']);
  const hasClaude = checkDependency('claude', ['--version']);
  const tmuxVersion = hasTmux ? checkTmuxVersion(3, 3) : { ok: false, version: null };

  if (!hasTmux) {
    console.error(`
  ❌ tmux not found.

  Install tmux:
    Ubuntu/Debian:  sudo apt install tmux
    macOS:          brew install tmux
    Windows:        winget install psmux
    `);
    process.exit(1);
  }

  if (!tmuxVersion.ok) {
    console.error(`
  ❌ Unsupported tmux version${tmuxVersion.version ? ` (${tmuxVersion.version})` : ''}.

  Aegis requires tmux/psmux 3.3 or newer.
  `);
    process.exit(1);
  }

  if (!hasClaude) {
    console.error(`
  ⚠️  Claude Code CLI not found.

  Install Claude Code:
    curl -fsSL https://claude.ai/install.sh | bash

  Sessions will fail to start without the 'claude' command.
    `);
    // Don't exit — server can still start, just sessions won't work
  }

  const port = parseIntSafe(process.env.AEGIS_PORT, 9100);
  printBanner(port);

  console.log(`  Dependencies:`);
  console.log(`    tmux:   ${hasTmux ? '✅' : '❌'}`);
  console.log(`    claude: ${hasClaude ? '✅' : '❌'}`);
  console.log('');

  // Start the server
  await import('./server.js');
}

main().catch(err => {
  console.error('Failed to start Aegis:', err);
  process.exit(1);
});

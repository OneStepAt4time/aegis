#!/usr/bin/env node
/**
 * cli.ts — CLI entry point for Aegis.
 *
 * `npx aegis-bridge` or `aegis-bridge` starts the server with sensible defaults.
 * Auto-detects tmux and claude CLI, prints helpful startup message.
 */

import { execSync } from 'node:child_process';

import { parseIntSafe } from './validation.js';

const VERSION = '1.2.0';

function checkDependency(name: string, command: string): boolean {
  try {
    execSync(`${command} 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function printBanner(port: number): void {
  console.log(`
  ┌─────────────────────────────────────────┐
  │          ⚡ Aegis v${VERSION}               │
  │    Claude Code Session Bridge            │
  └─────────────────────────────────────────┘
  `);
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
    console.error('  ❌ Missing brief. Usage: aegis-bridge create "Build a login page"');
    process.exit(1);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const sessionName = `cc-${brief.slice(0, 20).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;

  // Create session
  let sessionId: string;
  try {
    const res = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workDir: cwd, name: sessionName }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.error(`  ❌ Failed to create session: ${(err as any).error || res.statusText}`);
      process.exit(1);
    }

    const session = await res.json() as { id: string; windowName: string };
    sessionId = session.id;
    console.log(`  ✅ Session created: ${session.windowName}`);
    console.log(`     ID: ${sessionId}`);
  } catch (e: any) {
    if (e.cause?.code === 'ECONNREFUSED') {
      console.error(`  ❌ Cannot connect to Aegis on port ${port}.`);
      console.error(`     Start the server first: aegis-bridge`);
    } else {
      console.error(`  ❌ ${e.message}`);
    }
    process.exit(1);
  }

  // Send brief
  try {
    const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: brief }),
    });

    const result = await res.json() as { delivered?: boolean; attempts?: number };
    if (result.delivered) {
      console.log(`  ✅ Brief delivered (attempt ${result.attempts})`);
    } else {
      console.log(`  ⚠️  Brief sent but delivery not confirmed after ${result.attempts} attempts`);
    }
  } catch (e: any) {
    console.error(`  ⚠️  Failed to send brief: ${e.message}`);
  }

  // Print next steps
  console.log('');
  console.log('  Next steps:');
  console.log(`    Status:   curl ${baseUrl}/v1/sessions/${sessionId}/health`);
  console.log(`    Read:     curl ${baseUrl}/v1/sessions/${sessionId}/read`);
  console.log(`    Kill:     curl -X DELETE ${baseUrl}/v1/sessions/${sessionId}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  aegis-bridge — Claude Code session bridge

  Usage:
    aegis-bridge                  Start the server (port 9100)
    aegis-bridge --port 3000      Custom port
    aegis-bridge create "brief"   Create a session and send brief
    aegis-bridge mcp              Start MCP server (stdio transport)
    aegis-bridge --help           Show this help

  Create:
    aegis-bridge create "Build a login page" --cwd /path/to/project
    aegis-bridge create "Fix the tests"      (uses current directory)

  MCP server:
    aegis-bridge mcp              Start MCP stdio server
    aegis-bridge mcp --port 3000  Custom Aegis API port
    claude mcp add aegis -- npx aegis-bridge mcp

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
    console.log(`aegis-bridge v${VERSION}`);
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
    const mcpAuth = process.env.AEGIS_AUTH_TOKEN;
    const { startMcpServer } = await import('./mcp-server.js');
    await startMcpServer(mcpPort, mcpAuth);
    return; // stdio server runs until stdin closes
  }

  // Subcommand: create
  if (args[0] === 'create') {
    await handleCreate(args.slice(1));
    process.exit(0);
  }

  // Port override from CLI
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    process.env.AEGIS_PORT = args[portIdx + 1];
  }

  // Check dependencies
  const hasTmux = checkDependency('tmux', 'tmux -V');
  const hasClaude = checkDependency('claude', 'claude --version');

  if (!hasTmux) {
    console.error(`
  ❌ tmux not found.

  Install tmux:
    Ubuntu/Debian:  sudo apt install tmux
    macOS:          brew install tmux
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

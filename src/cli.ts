#!/usr/bin/env node
/**
 * cli.ts — CLI entry point for Aegis.
 *
 * `npx aegis-bridge` or `aegis-bridge` starts the server with sensible defaults.
 * Auto-detects tmux and claude CLI, prints helpful startup message.
 */

import { execSync } from 'node:child_process';

const VERSION = '1.1.0';

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Help
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  aegis-bridge — Claude Code session bridge

  Usage:
    aegis-bridge                  Start the server (port 9100)
    aegis-bridge --port 3000      Custom port
    aegis-bridge --help           Show this help

  Environment variables:
    AEGIS_PORT                    Server port (default: 9100)
    AEGIS_HOST                    Server host (default: 127.0.0.1)
    AEGIS_AUTH_TOKEN              Bearer token for API auth
    AEGIS_TMUX_SESSION            tmux session name (default: aegis)
    AEGIS_STATE_DIR               State directory (default: ~/.aegis)
    AEGIS_TG_TOKEN                Telegram bot token
    AEGIS_TG_GROUP                Telegram group chat ID
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

  const port = parseInt(process.env.AEGIS_PORT || '9100', 10);
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

/**
 * utils/claude-installer.ts — Detect and install the Claude Code CLI.
 *
 * Issue #3670: Clean-env setup broken without claude CLI.
 * Provides detection, install prompting, and auto-install for --yes mode.
 */

import { execFile } from 'node:child_process';
import { CliIO, writeLine, write } from '../cli-http.js';

const CLAUDE_DETECT_TIMEOUT_MS = 3_000;
const CLAUDE_INSTALL_TIMEOUT_MS = 120_000;

export interface ClaudeCheckResult {
  installed: boolean;
  version?: string;
  path?: string;
}

/**
 * Check if the Claude Code CLI is available on PATH.
 */
export async function checkClaudeInstalled(): Promise<ClaudeCheckResult> {
  // Check if claude is on PATH
  const pathResult = await new Promise<string | null>((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(cmd, ['claude'], { timeout: CLAUDE_DETECT_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? null : stdout.trim().split('\n')[0] || null);
    });
  });

  if (!pathResult) {
    return { installed: false };
  }

  // Get version
  const version = await new Promise<string | undefined>((resolve) => {
    execFile('claude', ['--version'], { timeout: CLAUDE_DETECT_TIMEOUT_MS }, (err, stdout) => {
      if (err) { resolve(undefined); return; }
      const match = (stdout ?? '').match(/(\d+\.\d+\.\d+)/);
      resolve(match?.[1]);
    });
  });

  return { installed: true, version, path: pathResult };
}

/**
 * Check if ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set in environment.
 * If so, the ACP runtime can authenticate without the Claude CLI.
 */
export function hasAnthropicCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Install the Claude Code CLI using the official install script.
 * Only works on Unix-like systems (Linux, macOS).
 */
export async function installClaudeCli(io: CliIO): Promise<boolean> {
  if (process.platform === 'win32') {
    writeLine(io.stderr, '  ❌ Automatic Claude CLI install is not supported on Windows.');
    writeLine(io.stderr, '     Install manually: npm install -g @anthropic-ai/claude-code');
    return false;
  }

  writeLine(io.stdout, '  📦 Installing Claude Code CLI...');

  const { spawn } = await import('node:child_process');
  return new Promise<boolean>((resolve) => {
    const curl = spawn('bash', ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLAUDE_INSTALL_TIMEOUT_MS,
    });

    let stderr = '';
    curl.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    curl.stdout?.on('data', (chunk: Buffer) => {
      // Forward install progress to stdout
      write(io.stdout, chunk.toString());
    });

    curl.on('close', (code) => {
      if (code === 0) {
        writeLine(io.stdout, '  ✅ Claude Code CLI installed successfully');
        resolve(true);
      } else {
        writeLine(io.stderr, `  ❌ Claude Code CLI install failed (exit code ${code})`);
        if (stderr) {
          writeLine(io.stderr, `     ${stderr.trim().split('\n').pop()}`);
        }
        writeLine(io.stderr, '     Install manually: curl -fsSL https://claude.ai/install.sh | bash');
        resolve(false);
      }
    });

    curl.on('error', (err) => {
      writeLine(io.stderr, `  ❌ Install failed: ${err.message}`);
      writeLine(io.stderr, '     Install manually: curl -fsSL https://claude.ai/install.sh | bash');
      resolve(false);
    });
  });
}

/**
 * Offer to install Claude CLI when it's missing.
 * In --yes mode, auto-installs. Otherwise, prompts.
 */
export async function ensureClaudeInstalled(
  args: string[],
  io: CliIO,
): Promise<{ ok: boolean; installed: boolean; skipped: boolean }> {
  const check = await checkClaudeInstalled();

  if (check.installed) {
    return { ok: true, installed: true, skipped: false };
  }

  // Check if ANTHROPIC_API_KEY is set — ACP can work without CLI
  if (hasAnthropicCredentials()) {
    writeLine(io.stdout, '  ℹ️  Claude CLI not found, but ANTHROPIC_API_KEY is set — sessions will work.');
    writeLine(io.stdout, '     (Install Claude CLI for the full experience: curl -fsSL https://claude.ai/install.sh | bash)');
    return { ok: true, installed: false, skipped: true };
  }

  const yes = args.includes('--yes') || args.includes('-y');
  const force = args.includes('--force') || args.includes('-f');

  writeLine(io.stdout);
  writeLine(io.stdout, '  ⚠️  Claude Code CLI not found and no ANTHROPIC_API_KEY set.');
  writeLine(io.stdout, '     Aegis needs Claude Code (or an ANTHROPIC_API_KEY) to run sessions.');

  if (yes || force) {
    writeLine(io.stdout, '  Installing automatically (--yes mode)...');
    const success = await installClaudeCli(io);
    return { ok: success, installed: success, skipped: false };
  }

  // Interactive: offer to install
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: io.stdin, output: io.stdout, terminal: true });
  try {
    writeLine(io.stdout);
    const answer = (await rl.question('  Install Claude Code CLI now? [Y/n]: ')).trim().toLowerCase();
    if (!answer || answer === 'y' || answer === 'yes') {
      const success = await installClaudeCli(io);
      return { ok: success, installed: success, skipped: false };
    }
  } finally {
    rl.close();
  }

  writeLine(io.stdout);
  writeLine(io.stdout, '  Install manually:');
  writeLine(io.stdout, '    curl -fsSL https://claude.ai/install.sh | bash');
  writeLine(io.stdout, '  Or set ANTHROPIC_API_KEY in your environment.');
  writeLine(io.stdout);
  return { ok: true, installed: false, skipped: true };
}

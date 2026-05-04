#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_PROMPT = 'Reply with exactly: AEGIS_ACP_PROBE_OK';

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    sessionCwd: process.cwd(),
    prompt: undefined,
    command: undefined,
    timeoutMs: undefined,
    resumeSession: false,
    closeSession: true,
    cancelAfterFirstUpdate: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      const value = argv[index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };

    switch (arg) {
      case '--cwd':
        options.cwd = next();
        break;
      case '--session-cwd':
        options.sessionCwd = next();
        break;
      case '--prompt':
        options.prompt = next();
        break;
      case '--bin':
        options.command = next();
        break;
      case '--timeout-ms':
        options.timeoutMs = Number.parseInt(next(), 10);
        if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error('--timeout-ms must be a positive integer');
        }
        break;
      case '--no-prompt':
        options.prompt = null;
        break;
      case '--resume':
        options.resumeSession = true;
        break;
      case '--no-close':
        options.closeSession = false;
        break;
      case '--cancel-after-first-update':
        options.cancelAfterFirstUpdate = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/acp-lifecycle-probe.mjs [options]

Runs the built ACP lifecycle probe against @agentclientprotocol/claude-agent-acp.
Build first with: npm run build

Options:
  --bin <path>                    ACP binary override. Defaults to AEGIS_ACP_BIN, local package bin, then npm exec.
  --cwd <path>                    Child process working directory. Default: current directory.
  --session-cwd <path>            ACP session/new cwd. Default: current directory.
  --prompt <text>                 Prompt to send after session/new. Default: ${DEFAULT_PROMPT}
  --no-prompt                     Stop after initialize and session/new.
  --resume                        Call session/resume after session/new.
  --no-close                      Do not call session/close before shutdown.
  --cancel-after-first-update     Send session/cancel after the first agent message update.
  --timeout-ms <number>           Per-request timeout. Default: probe module default.
  --help                          Show this help.

The summary intentionally omits environment variables and raw stderr to avoid leaking credentials.`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { resolveAcpCommand, runAcpLifecycleProbe } =
    await import('../dist/acp-lifecycle-probe.js');
  const resolvedCommand = parsed.command
    ? resolveAcpCommand({ explicitCommand: parsed.command, cwd: parsed.cwd })
    : undefined;
  const result = await runAcpLifecycleProbe({
    resolvedCommand,
    cwd: parsed.cwd,
    sessionCwd: parsed.sessionCwd,
    timeoutMs: parsed.timeoutMs,
    prompt: parsed.prompt === null ? undefined : (parsed.prompt ?? DEFAULT_PROMPT),
    resumeSession: parsed.resumeSession,
    closeSession: parsed.closeSession,
    cancelAfterFirstUpdate: parsed.cancelAfterFirstUpdate,
  });

  const summary = {
    command: {
      source: result.command.source,
      command: result.command.command,
      args: result.command.args,
    },
    initialize: result.initialize.result,
    sessionId: result.sessionId,
    resume: result.resume
      ? {
          received: true,
          resultKeys: Object.keys(result.resume.result),
        }
      : undefined,
    prompt: result.prompt?.result,
    close: result.close?.result,
    cancelSent: result.cancelSent,
    notificationMethods: result.notifications.map(message => message.method),
    stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
    exit: result.exit,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ACP lifecycle probe failed: ${message}`);
  process.exit(1);
});

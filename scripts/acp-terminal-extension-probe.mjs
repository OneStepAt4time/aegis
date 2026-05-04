#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_INPUT = 'AEGIS_ACP_TERMINAL_PROBE_INPUT\n';
const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 32;

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    sessionCwd: process.cwd(),
    command: undefined,
    timeoutMs: undefined,
    input: DEFAULT_INPUT,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
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
      case '--bin':
        options.command = next();
        break;
      case '--timeout-ms':
        options.timeoutMs = Number.parseInt(next(), 10);
        if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error('--timeout-ms must be a positive integer');
        }
        break;
      case '--input':
        options.input = next();
        break;
      case '--columns':
        options.columns = Number.parseInt(next(), 10);
        if (!Number.isInteger(options.columns) || options.columns <= 0) {
          throw new Error('--columns must be a positive integer');
        }
        break;
      case '--rows':
        options.rows = Number.parseInt(next(), 10);
        if (!Number.isInteger(options.rows) || options.rows <= 0) {
          throw new Error('--rows must be a positive integer');
        }
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
  console.log(`Usage: node scripts/acp-terminal-extension-probe.mjs [options]

Runs the built ACP terminal-extension parity probe against an ACP agent.
Build first with: npm run build

Options:
  --bin <path>           ACP binary override. Defaults to AEGIS_ACP_BIN, local package bin, then npm exec.
  --cwd <path>           Child process working directory. Default: current directory.
  --session-cwd <path>   ACP session/new cwd. Default: current directory.
  --input <text>         Terminal input used for echo/reconnect checks. Default: ${JSON.stringify(DEFAULT_INPUT)}
  --columns <number>     Resize columns. Default: ${DEFAULT_COLUMNS}
  --rows <number>        Resize rows. Default: ${DEFAULT_ROWS}
  --timeout-ms <number>  Per-request/event timeout. Default: probe module default.
  --help                 Show this help.

The summary omits environment variables and raw stderr to avoid leaking credentials.`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { resolveAcpCommand } = await import('../dist/acp-lifecycle-probe.js');
  const { runAcpTerminalExtensionProbe } = await import('../dist/acp-terminal-extension-probe.js');
  const resolvedCommand = parsed.command
    ? resolveAcpCommand({ explicitCommand: parsed.command, cwd: parsed.cwd })
    : undefined;
  const result = await runAcpTerminalExtensionProbe({
    resolvedCommand,
    cwd: parsed.cwd,
    sessionCwd: parsed.sessionCwd,
    timeoutMs: parsed.timeoutMs,
    input: parsed.input,
    resize: {
      columns: parsed.columns,
      rows: parsed.rows,
    },
  });

  const summary = {
    command: {
      source: result.command.source,
      command: result.command.command,
      args: result.command.args,
    },
    capabilities: result.capabilities,
    sessionId: result.sessionId,
    terminalId: result.terminalId,
    inputEchoBytes: Buffer.byteLength(result.inputEcho.data, 'utf8'),
    resize: {
      columns: result.resize.columns,
      rows: result.resize.rows,
    },
    reconnect: {
      replayedOutputBytes: Buffer.byteLength(result.reconnect.replayedOutput, 'utf8'),
      columns: result.reconnect.columns,
      rows: result.reconnect.rows,
    },
    debugMessages: result.debug.length,
    notificationMethods: result.notifications.map(message => message.method),
    stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
    exit: result.exit,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ACP terminal extension probe failed: ${message}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * cli.ts — CLI entry point for Aegis.
 *
 * `ag` is the primary CLI command and `aegis` remains an alias. Both start the
 * server with sensible defaults and support interactive project bootstrap via
 * `ag init`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { deriveBaseUrl, getConfiguredBaseUrl, getDashboardUrl, normalizeBaseUrl } from './base-url.js';
import { loadConfig, readConfigFile, serializeConfigFile, writeConfigFile, type Config } from './config.js';
import { runDoctorCommand } from './doctor.js';
import { AuthManager } from './services/auth/index.js';
import { buildEnvSchema, ENV_BYO_LLM_WHITELIST, getErrorMessage, parseIntSafe } from './validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
/** Current aegis version read from package.json at startup. */
const VERSION: string = pkg.version;

const BYO_ENV_FIELDS = [
  { key: 'ANTHROPIC_BASE_URL', label: 'ANTHROPIC base URL' },
  { key: 'ANTHROPIC_AUTH_TOKEN', label: 'ANTHROPIC auth token' },
  { key: 'ANTHROPIC_DEFAULT_MODEL', label: 'ANTHROPIC default model' },
  { key: 'ANTHROPIC_DEFAULT_FAST_MODEL', label: 'ANTHROPIC fast model' },
  { key: 'API_TIMEOUT_MS', label: 'API timeout (ms)' },
] as const;

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

interface InitSummary {
  authToken: string;
  baseUrl: string;
  commandPrefix: string;
  configPath: string;
  dashboardEnabled: boolean;
  tokenCreated: boolean;
  wroteConfig: boolean;
}

interface Prompter {
  close(): void;
  question(prompt: string): Promise<string>;
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

function defaultInitConfigPath(): string {
  return join(process.cwd(), '.aegis', 'config.yaml');
}

function resolveInitConfigPath(args: string[]): string {
  const idx = args.indexOf('--config');
  if (idx !== -1 && idx + 1 < args.length) {
    return resolve(args[idx + 1]!);
  }
  return defaultInitConfigPath();
}

function formatConfigPath(configPath: string): string {
  const relativePath = relative(process.cwd(), configPath);
  if (!relativePath || relativePath.startsWith('..')) {
    return configPath;
  }
  return relativePath;
}

function commandPrefixForConfig(configPath: string): string {
  if (configPath === defaultInitConfigPath()) {
    return 'ag';
  }
  return `ag --config "${configPath}"`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(entry => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateBaseUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must use http:// or https://');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Base URL must not include a path, query string, or hash');
  }
  return normalizeBaseUrl(input);
}

function filterByoEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const allowed = new Set<string>(ENV_BYO_LLM_WHITELIST);
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => allowed.has(key)),
  );
}

function resolveExistingToken(config: Partial<Config> | null): string {
  if (!config) return '';
  return config.clientAuthToken || config.authToken || '';
}

function buildInitComparisonConfig(
  config: Partial<Config>,
  hasGeneratedToken: boolean,
): Partial<Config> {
  if (!hasGeneratedToken) {
    return config;
  }
  return { ...config, clientAuthToken: '__generated__' };
}

function formatPromptDefault(defaultValue: string): string {
  return defaultValue ? ` [${defaultValue}]` : '';
}

async function readBufferedInput(input: NodeJS.ReadableStream): Promise<string[]> {
  let text = '';
  for await (const chunk of input) {
    text += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  }
  return text.split(/\r?\n/);
}

function createPrompter(io: CliIO): Prompter {
  if ('isTTY' in io.stdin && io.stdin.isTTY) {
    const rl = createInterface({
      input: io.stdin,
      output: io.stdout,
      terminal: true,
    });
    return {
      close: () => rl.close(),
      question: (prompt) => rl.question(prompt),
    };
  }

  const bufferedLinesPromise = readBufferedInput(io.stdin);
  let index = 0;
  return {
    close: () => {},
    async question(prompt: string): Promise<string> {
      write(io.stdout, prompt);
      const lines = await bufferedLinesPromise;
      const answer = lines[index] ?? '';
      index += 1;
      return answer;
    },
  };
}

async function promptLine(prompter: Prompter, label: string, defaultValue: string = ''): Promise<string> {
  const answer = await prompter.question(`${label}${formatPromptDefault(defaultValue)}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

async function promptBoolean(
  prompter: Prompter,
  io: CliIO,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  for (;;) {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = (await prompter.question(`${label} ${suffix}: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    writeLine(io.stderr, '  ❌ Please answer y or n.');
  }
}

async function promptBaseUrl(
  prompter: Prompter,
  io: CliIO,
  defaultValue: string,
): Promise<string> {
  for (;;) {
    const answer = await promptLine(prompter, 'Base URL', defaultValue);
    try {
      return validateBaseUrl(answer);
    } catch (error) {
      writeLine(io.stderr, `  ❌ ${getErrorMessage(error)}`);
    }
  }
}

async function promptByoEnv(
  prompter: Prompter,
  io: CliIO,
  existingByoEnv: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  const shouldConfigure = await promptBoolean(
    prompter,
    io,
    'Configure optional BYO-LLM defaults for every session?',
    Object.keys(existingByoEnv).length > 0,
  );
  if (!shouldConfigure) {
    return undefined;
  }

  const nextEnv: Record<string, string> = { ...existingByoEnv };
  for (const field of BYO_ENV_FIELDS) {
    for (;;) {
      const answer = await promptLine(prompter, `  ${field.label}`, existingByoEnv[field.key] ?? '');
      if (field.key === 'API_TIMEOUT_MS' && answer && !/^[1-9]\d*$/.test(answer)) {
        writeLine(io.stderr, '  ❌ API timeout must be a positive integer.');
        continue;
      }
      if (answer) {
        nextEnv[field.key] = answer;
      } else {
        delete nextEnv[field.key];
      }
      break;
    }
  }

  const parsed = buildEnvSchema().safeParse(nextEnv);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => issue.message).join('; '));
  }
  return parsed.data;
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

function printInitSummary(io: CliIO, summary: InitSummary): void {
  writeLine(io.stdout);
  writeLine(io.stdout, summary.wroteConfig
    ? `  ✅ Wrote ${summary.configPath}`
    : `  ✅ Using existing ${summary.configPath}`);
  writeLine(io.stdout, summary.tokenCreated
    ? '  ✅ Created admin API token'
    : summary.authToken
      ? '  ✅ Reusing existing API token'
      : '  ⚠️  No API token configured');
  writeLine(io.stdout);
  writeLine(io.stdout, '  Next steps:');
  writeLine(io.stdout, `    Start:      ${summary.commandPrefix}`);
  if (summary.dashboardEnabled) {
    writeLine(io.stdout, `    Dashboard:  ${getDashboardUrl(summary.baseUrl)}`);
  } else {
    writeLine(io.stdout, '    Dashboard:  disabled in config');
  }
  if (summary.authToken) {
    writeLine(io.stdout, `    API token:  ${summary.authToken}`);
  } else {
    writeLine(io.stdout, '    API token:  set AEGIS_AUTH_TOKEN or re-run ag init to create one');
  }
  writeLine(io.stdout, `    Session:    ${summary.commandPrefix} create "Describe your first task" --cwd .`);
}

async function handleInit(args: string[], io: CliIO): Promise<number> {
  const yes = args.includes('--yes') || args.includes('-y');
  const configPath = resolveInitConfigPath(args);
  const displayConfigPath = formatConfigPath(configPath);
  const commandPrefix = commandPrefixForConfig(configPath);
  const existingConfigText = existsSync(configPath)
    ? await readFile(configPath, 'utf-8').catch(() => null)
    : null;
  const existingConfig = await readConfigFile(configPath);
  const existingToken = resolveExistingToken(existingConfig);
  const existingByoEnv = filterByoEnv(existingConfig?.defaultSessionEnv);
  const currentConfig = await loadConfig();

  if (existingConfigText !== null && existingConfig === null && yes) {
    writeLine(
      io.stderr,
      `  ❌ ${displayConfigPath} already exists but could not be parsed. Re-run without --yes to confirm overwrite.`,
    );
    return 1;
  }

  let createAdminToken = existingToken ? false : true;
  let baseUrl = existingConfig?.baseUrl
    ? normalizeBaseUrl(existingConfig.baseUrl)
    : getConfiguredBaseUrl(currentConfig);
  let byoEnv: Record<string, string> | undefined;
  let dashboardEnabled = existingConfig?.dashboardEnabled ?? true;

  if (!yes) {
    const prompter = createPrompter(io);

    try {
      writeLine(io.stdout, `  Bootstrap config: ${displayConfigPath}`);
      writeLine(io.stdout);
      createAdminToken = await promptBoolean(
        prompter,
        io,
        existingToken
          ? 'Create a fresh admin API token for dashboard + CLI access?'
          : 'Create an admin API token for dashboard + CLI access?',
        !existingToken,
      );
      baseUrl = await promptBaseUrl(prompter, io, baseUrl);
      byoEnv = await promptByoEnv(prompter, io, existingByoEnv);
      dashboardEnabled = await promptBoolean(prompter, io, 'Enable the bundled dashboard?', dashboardEnabled);
    } finally {
      prompter.close();
    }
  }

  const nextConfig: Partial<Config> = { ...(existingConfig ?? {}) };
  nextConfig.baseUrl = baseUrl;
  nextConfig.dashboardEnabled = dashboardEnabled;

  if (byoEnv) {
    nextConfig.defaultSessionEnv = {
      ...(existingConfig?.defaultSessionEnv ?? {}),
      ...byoEnv,
    };
  }

  if (!nextConfig.defaultSessionEnv || Object.keys(nextConfig.defaultSessionEnv).length === 0) {
    delete nextConfig.defaultSessionEnv;
  }

  const generatedTokenRequested = createAdminToken;
  const desiredComparison = stableStringify(
    buildInitComparisonConfig(nextConfig, generatedTokenRequested),
  );
  const existingComparison = existingConfig
    ? stableStringify(existingConfig)
    : '';
  const needsWrite = existingConfigText === null || existingConfig === null || desiredComparison !== existingComparison;

  if (existingConfigText !== null && needsWrite) {
    if (yes) {
      writeLine(io.stdout, `  ℹ️  Left ${displayConfigPath} unchanged because --yes never overwrites existing files.`);
      printInitSummary(io, {
        authToken: existingToken,
        baseUrl: existingConfig?.baseUrl ? normalizeBaseUrl(existingConfig.baseUrl) : baseUrl,
        commandPrefix,
        configPath: displayConfigPath,
        dashboardEnabled: existingConfig?.dashboardEnabled ?? dashboardEnabled,
        tokenCreated: false,
        wroteConfig: false,
      });
      return 0;
    }

    const prompter = createPrompter(io);
    try {
      const overwrite = await promptBoolean(prompter, io, `Overwrite ${displayConfigPath}?`, false);
      if (!overwrite) {
        if (!existingConfig) {
          writeLine(io.stderr, `  ❌ Existing ${displayConfigPath} was left unchanged and is still invalid.`);
          return 1;
        }
        printInitSummary(io, {
          authToken: existingToken,
          baseUrl: existingConfig.baseUrl ? normalizeBaseUrl(existingConfig.baseUrl) : baseUrl,
          commandPrefix,
          configPath: displayConfigPath,
          dashboardEnabled: existingConfig.dashboardEnabled ?? dashboardEnabled,
          tokenCreated: false,
          wroteConfig: false,
        });
        return 0;
      }
    } finally {
      prompter.close();
    }
  }

  if (!needsWrite && !generatedTokenRequested) {
    printInitSummary(io, {
      authToken: existingToken,
      baseUrl,
      commandPrefix,
      configPath: displayConfigPath,
      dashboardEnabled,
      tokenCreated: false,
      wroteConfig: false,
    });
    return 0;
  }

  let authToken = existingToken;
  let tokenCreated = false;
  let createdKeyId: string | null = null;
  const authManager = new AuthManager(join(currentConfig.stateDir, 'keys.json'), currentConfig.authToken);
  await authManager.load();

  if (generatedTokenRequested) {
    const createdKey = await authManager.createKey('ag-init-admin', 100, undefined, 'admin');
    authToken = createdKey.key;
    createdKeyId = createdKey.id;
    nextConfig.clientAuthToken = createdKey.key;
    tokenCreated = true;
  }

  const finalConfigText = serializeConfigFile(nextConfig, configPath);
  if (existingConfigText !== null && existingConfigText === finalConfigText && !tokenCreated) {
    printInitSummary(io, {
      authToken,
      baseUrl,
      commandPrefix,
      configPath: displayConfigPath,
      dashboardEnabled,
      tokenCreated: false,
      wroteConfig: false,
    });
    return 0;
  }

  try {
    await writeConfigFile(configPath, nextConfig);
  } catch (error) {
    if (createdKeyId) {
      await authManager.revokeKey(createdKeyId);
    }
    writeLine(io.stderr, `  ❌ Failed to write ${displayConfigPath}: ${getErrorMessage(error)}`);
    return 1;
  }

  printInitSummary(io, {
    authToken,
    baseUrl,
    commandPrefix,
    configPath: displayConfigPath,
    dashboardEnabled,
    tokenCreated,
    wroteConfig: true,
  });
  return 0;
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
    ag "brief"             Create a session and send brief (shorthand)
    ag --port 3000         Custom port
    ag create "brief"      Create a session and send brief
    ag doctor              Run local diagnostics
    ag mcp                 Start MCP server (stdio transport)
    ag --help              Show this help

  Init:
    ag init
    ag init --yes

  Create:
    ag create "Build a login page" --cwd /path/to/project
    ag create "Fix the tests"      (uses current directory)

  Doctor:
    ag doctor              Check dependencies, config, network, and audit health
    ag doctor --port 3000  Check a custom API port
    ag doctor --json       Emit machine-readable diagnostics

  MCP server:
    ag mcp                 Start MCP stdio server
    ag mcp --port 3000     Custom Aegis API port
    claude mcp add aegis -- ag mcp

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
    return runDoctorCommand(argv.slice(1));
  }

  if (argv[0] === 'create') {
    return handleCreate(argv.slice(1), io);
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
    return fileURLToPath(import.meta.url) === process.argv[1];
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

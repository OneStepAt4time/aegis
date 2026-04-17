import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AuditLogger } from './audit.js';
import {
  findConfigFilePath,
  getConfig,
  loadConfig,
  loadSpecificConfigFile,
  type Config,
} from './config.js';
import { findPidOnPort } from './process-utils.js';
import {
  compareSemver,
  extractCCVersion,
  getErrorMessage,
  parseIntSafe,
} from './validation.js';

const COMMAND_TIMEOUT_MS = 5_000;
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;
const HEALTH_PATH = '/v1/health';
const STATE_DIR_PROBE_PREFIX = '.ag-doctor-';

export const MIN_NODE_VERSION = '20.0.0';
export const MIN_TMUX_VERSION = '3.2.0';

export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorOptions {
  json: boolean;
  portArg?: string;
}

export interface DoctorCheck {
  key: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorSummary {
  total: number;
  passed: number;
  warnings: number;
  failed: number;
}

export interface DoctorReport {
  ok: boolean;
  timestamp: string;
  baseUrl: string;
  configPath: string | null;
  stateDir: string;
  auditDir: string;
  summary: DoctorSummary;
  checks: DoctorCheck[];
}

export interface DoctorCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  notFound: boolean;
  error?: string;
}

export interface DoctorStateDirResult {
  ok: boolean;
  created: boolean;
  error?: string;
}

export interface DoctorAuditResult {
  valid: boolean;
  brokenAt?: number;
  file?: string;
  fileCount: number;
}

export interface DoctorBaseUrlResult {
  ok: boolean;
  statusCode?: number;
  statusText?: string;
  healthStatus?: string;
  error?: string;
}

interface ClaudeAuthMetadata {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

export interface DoctorConfigContext {
  config: Config;
  configPath: string | null;
  check: DoctorCheck;
}

export interface DoctorDependencies {
  runCommand: (command: string, args: string[]) => Promise<DoctorCommandResult>;
  readConfigContext: () => Promise<DoctorConfigContext>;
  fetch: typeof globalThis.fetch;
  findPidOnPort: (port: number) => Promise<number[]>;
  probeStateDirWriteAccess: (stateDir: string) => Promise<DoctorStateDirResult>;
  verifyAuditChain: (auditDir: string) => Promise<DoctorAuditResult>;
}

export interface DoctorConsole {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function trimCommandOutput(output: string | null | undefined): string {
  return (output ?? '').trim();
}

function normalizeCommandMessage(value: string | undefined): string {
  return trimCommandOutput(value).replace(/\s+/g, ' ');
}

async function defaultRunCommand(command: string, args: string[]): Promise<DoctorCommandResult> {
  return new Promise(resolve => {
    execFile(
      command,
      args,
      {
        encoding: 'utf-8',
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        const trimmedStdout = trimCommandOutput(stdout);
        const trimmedStderr = trimCommandOutput(stderr);
        if (!error) {
          resolve({
            ok: true,
            stdout: trimmedStdout,
            stderr: trimmedStderr,
            exitCode: 0,
            notFound: false,
          });
          return;
        }

        const err = error as NodeJS.ErrnoException;
        resolve({
          ok: false,
          stdout: trimmedStdout,
          stderr: trimmedStderr,
          exitCode: typeof err.code === 'number' ? err.code : null,
          notFound: err.code === 'ENOENT',
          error: err.message,
        });
      },
    );
  });
}

async function withMutedConsole<T>(work: () => Promise<T>): Promise<T> {
  const globalConsole = globalThis.console;
  const originalLog = globalConsole.log;
  const originalWarn = globalConsole.warn;
  const mute = (..._args: unknown[]): void => {};

  globalConsole.log = mute;
  globalConsole.warn = mute;
  try {
    return await work();
  } finally {
    globalConsole.log = originalLog;
    globalConsole.warn = originalWarn;
  }
}

function isLegacyConfigPath(configPath: string): boolean {
  const normalized = configPath.toLowerCase();
  return normalized.endsWith(`${path.sep}manus.config.json`)
    || normalized.includes(`${path.sep}.manus${path.sep}`);
}

async function defaultReadConfigContext(): Promise<DoctorConfigContext> {
  const configPath = findConfigFilePath();
  if (configPath) {
    const parsed = await loadSpecificConfigFile(configPath);
    if (!parsed) {
      return {
        config: getConfig(),
        configPath,
        check: {
          key: 'config',
          label: 'Config',
          status: 'fail',
          message: `Invalid config file: ${configPath}`,
          details: { path: configPath },
        },
      };
    }
  }

  const config = await withMutedConsole(async () => loadConfig());
  if (!configPath) {
    return {
      config,
      configPath: null,
      check: {
        key: 'config',
        label: 'Config',
        status: 'ok',
        message: 'Using defaults and environment overrides',
        details: {
          path: null,
          host: config.host,
          port: config.port,
          stateDir: config.stateDir,
        },
      },
    };
  }

  const legacy = isLegacyConfigPath(configPath);
  return {
    config,
    configPath,
    check: {
      key: 'config',
      label: 'Config',
      status: legacy ? 'warn' : 'ok',
      message: legacy ? `Loaded legacy config: ${configPath}` : `Loaded ${configPath}`,
      details: {
        path: configPath,
        legacy,
        host: config.host,
        port: config.port,
        stateDir: config.stateDir,
      },
    },
  };
}

async function defaultProbeStateDirWriteAccess(stateDir: string): Promise<DoctorStateDirResult> {
  const existedBefore = existsSync(stateDir);
  const probePath = path.join(stateDir, `${STATE_DIR_PROBE_PREFIX}${process.pid}-${Date.now()}.tmp`);

  try {
    await mkdir(stateDir, { recursive: true });
    await writeFile(probePath, 'ok', { encoding: 'utf-8', mode: 0o600 });
    await rm(probePath, { force: true });
    if (!existedBefore) {
      try {
        await rm(stateDir);
      } catch {
        // Best-effort cleanup for a directory created only by the probe.
      }
    }
    return { ok: true, created: !existedBefore };
  } catch (error) {
    try {
      await rm(probePath, { force: true });
    } catch {
      // Ignore probe cleanup failures.
    }
    return { ok: false, created: !existedBefore, error: getErrorMessage(error) };
  }
}

async function defaultVerifyAuditChain(auditDir: string): Promise<DoctorAuditResult> {
  let fileCount = 0;
  try {
    const files = existsSync(auditDir) ? await readdir(auditDir) : [];
    fileCount = files.filter(file => file.startsWith('audit-') && file.endsWith('.log')).length;
  } catch {
    fileCount = 0;
  }

  const auditLogger = new AuditLogger(auditDir);
  const result = await auditLogger.verify();
  return { ...result, fileCount };
}

function createDoctorDependencies(): DoctorDependencies {
  return {
    runCommand: defaultRunCommand,
    readConfigContext: defaultReadConfigContext,
    fetch: globalThis.fetch,
    findPidOnPort,
    probeStateDirWriteAccess: defaultProbeStateDirWriteAccess,
    verifyAuditChain: defaultVerifyAuditChain,
  };
}

export function parseDoctorArgs(args: string[]): DoctorOptions {
  let json = false;
  let portArg: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      json = true;
      continue;
    }
    if (args[i] === '--port' && args[i + 1]) {
      portArg = args[++i];
    }
  }

  return { json, portArg };
}

export function parseTmuxVersion(output: string): string | null {
  const match = trimCommandOutput(output).match(/tmux\s+(\d+)\.(\d+)/i);
  if (!match) return null;
  return `${match[1]}.${match[2]}.0`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAegisHealthPayload(value: unknown): value is { status: string; version: string } {
  return isRecord(value)
    && typeof value.status === 'string'
    && typeof value.version === 'string';
}

function parseClaudeAuthMetadata(output: string): ClaudeAuthMetadata | null {
  try {
    const parsed = JSON.parse(output);
    if (!isRecord(parsed)) return null;
    return {
      loggedIn: typeof parsed.loggedIn === 'boolean' ? parsed.loggedIn : undefined,
      authMethod: typeof parsed.authMethod === 'string' ? parsed.authMethod : undefined,
      apiProvider: typeof parsed.apiProvider === 'string' ? parsed.apiProvider : undefined,
      subscriptionType: typeof parsed.subscriptionType === 'string' ? parsed.subscriptionType : undefined,
    };
  } catch {
    return null;
  }
}

export function normalizeDoctorHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || trimmed === '0.0.0.0') return '127.0.0.1';
  if (trimmed === '::' || trimmed === '[::]') return '[::1]';
  if (trimmed.includes(':') && !trimmed.startsWith('[')) return `[${trimmed}]`;
  return trimmed;
}

export function buildDoctorBaseUrl(host: string, port: number): string {
  return `http://${normalizeDoctorHost(host)}:${port}`;
}

export function evaluatePortCheck(port: number, pids: number[], baseUrlReachable: boolean): DoctorCheck {
  if (baseUrlReachable) {
    return {
      key: 'port',
      label: 'Port',
      status: 'ok',
      message: pids.length > 0
        ? `${port} is serving Aegis (PID${pids.length === 1 ? '' : 's'} ${pids.join(', ')})`
        : `${port} is serving Aegis`,
      details: { port, pids },
    };
  }

  if (pids.length === 0) {
    return {
      key: 'port',
      label: 'Port',
      status: 'ok',
      message: `${port} is free for Aegis to bind`,
      details: { port, pids },
    };
  }

  return {
    key: 'port',
    label: 'Port',
    status: 'fail',
    message: `${port} is occupied by PID${pids.length === 1 ? '' : 's'} ${pids.join(', ')}`,
    details: { port, pids },
  };
}

function summarizeCommandFailure(result: DoctorCommandResult): string {
  if (result.notFound) return 'not found in PATH';
  const message = normalizeCommandMessage(result.stderr)
    || normalizeCommandMessage(result.stdout)
    || normalizeCommandMessage(result.error);
  if (message) return message;
  return result.exitCode === null ? 'command failed' : `exited with code ${result.exitCode}`;
}

async function checkBaseUrlReachability(
  fetchFn: typeof globalThis.fetch,
  baseUrl: string,
): Promise<DoctorBaseUrlResult> {
  try {
    const response = await fetchFn(`${baseUrl}${HEALTH_PATH}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    });

    let payload: unknown = null;
    try {
      payload = await response.clone().json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        statusText: response.statusText,
        error: `${response.status} ${response.statusText}`,
      };
    }

    const looksLikeAegis = response.headers.get('x-aegis-api-version') === '1'
      || isAegisHealthPayload(payload);
    if (!looksLikeAegis) {
      return {
        ok: false,
        statusCode: response.status,
        statusText: response.statusText,
        error: 'unexpected health response',
      };
    }

    return {
      ok: true,
      statusCode: response.status,
      statusText: response.statusText,
      healthStatus: isAegisHealthPayload(payload) ? payload.status : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error),
    };
  }
}

function buildSummary(checks: DoctorCheck[]): DoctorSummary {
  return checks.reduce<DoctorSummary>((summary, check) => {
    summary.total += 1;
    if (check.status === 'ok') summary.passed += 1;
    if (check.status === 'warn') summary.warnings += 1;
    if (check.status === 'fail') summary.failed += 1;
    return summary;
  }, {
    total: 0,
    passed: 0,
    warnings: 0,
    failed: 0,
  });
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatDoctorReport(report: DoctorReport): string {
  const iconByStatus: Record<DoctorCheckStatus, string> = {
    ok: '✅',
    warn: '⚠️',
    fail: '❌',
  };
  const labelWidth = Math.max(...report.checks.map(check => check.label.length));
  const lines = ['Aegis doctor', ''];

  for (const check of report.checks) {
    const paddedLabel = check.label.padEnd(labelWidth, ' ');
    lines.push(`${iconByStatus[check.status]} ${paddedLabel}  ${check.message}`);
  }

  lines.push('');
  if (report.summary.failed > 0) {
    lines.push(
      `${pluralize(report.summary.failed, 'check')} failed`
      + (report.summary.warnings > 0 ? `, ${pluralize(report.summary.warnings, 'warning')}` : '')
      + '.',
    );
  } else if (report.summary.warnings > 0) {
    lines.push(`All required checks passed with ${pluralize(report.summary.warnings, 'warning')}.`);
  } else {
    lines.push(`All ${pluralize(report.summary.total, 'check')} passed.`);
  }

  return lines.join('\n');
}

export async function runDoctorChecks(
  options: DoctorOptions,
  dependencies: DoctorDependencies = createDoctorDependencies(),
): Promise<DoctorReport> {
  const configContext = await dependencies.readConfigContext();
  const port = parseIntSafe(options.portArg, configContext.config.port, {
    context: 'doctor port',
    strict: true,
    min: 1,
    max: 65535,
  });
  const baseUrl = buildDoctorBaseUrl(configContext.config.host, port);
  const auditDir = path.join(configContext.config.stateDir, 'audit');

  const [
    tmuxVersionResult,
    claudeVersionResult,
    claudeAuthResult,
    stateDirResult,
    auditResult,
    portPids,
    baseUrlResult,
  ] = await Promise.all([
    dependencies.runCommand('tmux', ['-V']),
    dependencies.runCommand('claude', ['--version']),
    dependencies.runCommand('claude', ['auth', 'status']),
    dependencies.probeStateDirWriteAccess(configContext.config.stateDir),
    dependencies.verifyAuditChain(auditDir),
    dependencies.findPidOnPort(port),
    checkBaseUrlReachability(dependencies.fetch, baseUrl),
  ]);

  const checks: DoctorCheck[] = [configContext.check];

  const nodeVersion = process.versions.node;
  const nodeOk = compareSemver(nodeVersion, MIN_NODE_VERSION) >= 0;
  checks.push({
    key: 'node',
    label: 'Node.js',
    status: nodeOk ? 'ok' : 'fail',
    message: nodeOk
      ? `v${nodeVersion}`
      : `v${nodeVersion} (requires >= ${MIN_NODE_VERSION})`,
    details: { version: nodeVersion, minimum: MIN_NODE_VERSION },
  });

  if (!tmuxVersionResult.ok) {
    checks.push({
      key: 'tmux',
      label: 'tmux',
      status: 'fail',
      message: summarizeCommandFailure(tmuxVersionResult),
      details: { minimum: MIN_TMUX_VERSION },
    });
  } else {
    const tmuxVersion = parseTmuxVersion(tmuxVersionResult.stdout);
    const supported = tmuxVersion !== null && compareSemver(tmuxVersion, MIN_TMUX_VERSION) >= 0;
    checks.push({
      key: 'tmux',
      label: 'tmux',
      status: supported ? 'ok' : 'fail',
      message: supported
        ? `v${tmuxVersion!.slice(0, -2)}`
        : tmuxVersion
          ? `v${tmuxVersion.slice(0, -2)} (requires >= ${MIN_TMUX_VERSION.slice(0, -2)})`
          : `Could not parse version from "${tmuxVersionResult.stdout}"`,
      details: {
        output: tmuxVersionResult.stdout,
        version: tmuxVersion,
        minimum: MIN_TMUX_VERSION,
      },
    });
  }

  if (!claudeVersionResult.ok) {
    checks.push({
      key: 'claude-cli',
      label: 'Claude CLI',
      status: 'fail',
      message: summarizeCommandFailure(claudeVersionResult),
    });
  } else {
    const claudeVersion = extractCCVersion(claudeVersionResult.stdout);
    checks.push({
      key: 'claude-cli',
      label: 'Claude CLI',
      status: 'ok',
      message: claudeVersion ? `v${claudeVersion}` : 'installed',
      details: {
        output: claudeVersionResult.stdout,
        version: claudeVersion,
      },
    });
  }

  const claudeAuthMetadata = parseClaudeAuthMetadata(claudeAuthResult.stdout);
  checks.push({
    key: 'claude-auth',
    label: 'Claude auth',
    status: claudeAuthResult.ok ? 'ok' : 'fail',
    message: claudeAuthResult.ok
      ? claudeAuthMetadata?.authMethod
        ? `authenticated via ${claudeAuthMetadata.authMethod}`
        : 'authenticated'
      : claudeVersionResult.ok
        ? claudeAuthMetadata?.loggedIn === false
          ? 'not authenticated'
          : summarizeCommandFailure(claudeAuthResult)
        : 'Claude CLI is not installed',
    details: {
      exitCode: claudeAuthResult.exitCode,
      loggedIn: claudeAuthMetadata?.loggedIn,
      authMethod: claudeAuthMetadata?.authMethod,
      apiProvider: claudeAuthMetadata?.apiProvider,
      subscriptionType: claudeAuthMetadata?.subscriptionType,
    },
  });

  checks.push({
    key: 'state-dir',
    label: 'State dir',
    status: stateDirResult.ok ? 'ok' : 'fail',
    message: stateDirResult.ok
      ? stateDirResult.created
        ? `${configContext.config.stateDir} is writable (created during probe)`
        : `${configContext.config.stateDir} is writable`
      : `${configContext.config.stateDir} is not writable: ${stateDirResult.error ?? 'write probe failed'}`,
    details: {
      stateDir: configContext.config.stateDir,
      created: stateDirResult.created,
      error: stateDirResult.error,
    },
  });

  checks.push(evaluatePortCheck(port, portPids, baseUrlResult.ok));

  checks.push({
    key: 'base-url',
    label: 'Base URL',
    status: baseUrlResult.ok ? 'ok' : 'fail',
    message: baseUrlResult.ok
      ? `${baseUrl}${HEALTH_PATH} reachable${baseUrlResult.healthStatus ? ` (status=${baseUrlResult.healthStatus})` : ''}`
      : `${baseUrl}${HEALTH_PATH} unreachable: ${baseUrlResult.error ?? 'health probe failed'}`,
    details: {
      baseUrl,
      healthPath: HEALTH_PATH,
      statusCode: baseUrlResult.statusCode,
      statusText: baseUrlResult.statusText,
      healthStatus: baseUrlResult.healthStatus,
      error: baseUrlResult.error,
    },
  });

  checks.push({
    key: 'audit-chain',
    label: 'Audit chain',
    status: auditResult.valid ? 'ok' : 'fail',
    message: auditResult.valid
      ? auditResult.fileCount > 0
        ? `valid across ${pluralize(auditResult.fileCount, 'log file')}`
        : 'valid (no audit log files yet)'
      : `invalid at ${auditResult.file ?? 'audit log'} line ${auditResult.brokenAt ?? 'unknown'}`,
    details: {
      auditDir,
      file: auditResult.file,
      brokenAt: auditResult.brokenAt,
      fileCount: auditResult.fileCount,
    },
  });

  const summary = buildSummary(checks);
  return {
    ok: summary.failed === 0,
    timestamp: new Date().toISOString(),
    baseUrl,
    configPath: configContext.configPath,
    stateDir: configContext.config.stateDir,
    auditDir,
    summary,
    checks,
  };
}

export async function runDoctorCommand(
  args: string[],
  io: DoctorConsole = console,
  dependencies?: DoctorDependencies,
): Promise<number> {
  const options = parseDoctorArgs(args);
  try {
    const report = await runDoctorChecks(options, dependencies);
    io.log(options.json ? JSON.stringify(report, null, 2) : formatDoctorReport(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    if (options.json) {
      io.log(JSON.stringify({
        ok: false,
        error: getErrorMessage(error),
      }, null, 2));
    } else {
      io.error(`ag doctor failed: ${getErrorMessage(error)}`);
    }
    return 1;
  }
}

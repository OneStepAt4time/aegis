import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireFromAegis = createRequire(import.meta.url);

export const CLAUDE_AGENT_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp';
export const CLAUDE_AGENT_ACP_BIN = 'claude-agent-acp';
export const AEGIS_ACP_BIN_ENV = 'AEGIS_ACP_BIN';

export type AcpCommandSource = 'explicit' | 'AEGIS_ACP_BIN' | 'bundled-package-bin';

export interface ResolvedAcpCommand {
  command: string;
  args: string[];
  source: AcpCommandSource;
  binName?: string;
  binPath?: string;
  packageName?: string;
  packageJsonPath?: string;
}

export interface ResolveAcpCommandOptions {
  explicitCommand?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  nodeExecPath?: string;
  fileExists?: (candidate: string) => boolean;
  resolvePackageJsonPath?: () => string | undefined;
  readPackageJson?: (packageJsonPath: string) => unknown;
}

export interface AcpBinaryResolutionErrorDetails {
  attemptedPaths: string[];
  binName: string;
  envVar: string;
  packageName: string;
  packageJsonPath?: string;
  reason?: string;
}

export class AcpBinaryResolutionError extends Error {
  readonly code = 'AEGIS_ACP_BINARY_NOT_FOUND';
  readonly details: AcpBinaryResolutionErrorDetails;

  constructor(message: string, details: AcpBinaryResolutionErrorDetails) {
    super(message);
    this.name = 'AcpBinaryResolutionError';
    this.details = details;
  }
}

export function resolveClaudeAgentAcpBinary(
  options: ResolveAcpCommandOptions = {}
): ResolvedAcpCommand {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (options.explicitCommand && options.explicitCommand.trim() !== '') {
    return toSpawnableCommand(options.explicitCommand, [], 'explicit', platform);
  }

  const envCommand = env[AEGIS_ACP_BIN_ENV];
  if (envCommand && envCommand.trim() !== '') {
    return {
      ...toSpawnableCommand(envCommand, [], 'AEGIS_ACP_BIN', platform),
      binName: CLAUDE_AGENT_ACP_BIN,
      packageName: CLAUDE_AGENT_ACP_PACKAGE,
    };
  }

  const packageJsonPath = resolvePackageJsonPath(options);
  const attemptedPaths: string[] = [];
  if (packageJsonPath !== undefined) {
    const binPath = resolvePackageBinPath(packageJsonPath, options, platform);
    attemptedPaths.push(binPath);
    const fileExists = options.fileExists ?? existsSync;
    if (fileExists(binPath)) {
      return {
        command: options.nodeExecPath ?? process.execPath,
        args: [binPath],
        source: 'bundled-package-bin',
        binName: CLAUDE_AGENT_ACP_BIN,
        binPath,
        packageName: CLAUDE_AGENT_ACP_PACKAGE,
        packageJsonPath,
      };
    }
  }

  throw new AcpBinaryResolutionError(
    `Unable to resolve ${CLAUDE_AGENT_ACP_BIN}; install ${CLAUDE_AGENT_ACP_PACKAGE} or set ${AEGIS_ACP_BIN_ENV}`,
    {
      attemptedPaths,
      binName: CLAUDE_AGENT_ACP_BIN,
      envVar: AEGIS_ACP_BIN_ENV,
      packageName: CLAUDE_AGENT_ACP_PACKAGE,
      packageJsonPath,
      reason: packageJsonPath === undefined ? 'package.json not found' : 'package bin not found',
    }
  );
}

function resolvePackageJsonPath(options: ResolveAcpCommandOptions): string | undefined {
  if (options.resolvePackageJsonPath) {
    return options.resolvePackageJsonPath();
  }

  try {
    return requireFromAegis.resolve(`${CLAUDE_AGENT_ACP_PACKAGE}/package.json`);
  } catch {
    const packageJsonFromModuleTree = resolvePackageJsonPathFromModuleTree(options);
    if (packageJsonFromModuleTree) return packageJsonFromModuleTree;

    const packageJsonFromEntrypoint = resolvePackageJsonPathFromEntrypoint(options);
    return (
      packageJsonFromEntrypoint ??
      resolvePackageJsonPathFromCwd(options.cwd ?? process.cwd(), options)
    );
  }
}

function resolvePackageJsonPathFromModuleTree(
  options: ResolveAcpCommandOptions
): string | undefined {
  const fileExists = options.fileExists ?? existsSync;
  let directory = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const candidate = path.join(
      directory,
      'node_modules',
      '@agentclientprotocol',
      'claude-agent-acp',
      'package.json'
    );
    if (fileExists(candidate)) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function resolvePackageJsonPathFromEntrypoint(
  options: ResolveAcpCommandOptions
): string | undefined {
  let entrypoint: string;
  try {
    entrypoint = requireFromAegis.resolve(CLAUDE_AGENT_ACP_PACKAGE);
  } catch {
    return undefined;
  }

  const fileExists = options.fileExists ?? existsSync;
  let directory = path.dirname(entrypoint);
  while (true) {
    const candidate = path.join(directory, 'package.json');
    if (fileExists(candidate)) return candidate;

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function resolvePackageJsonPathFromCwd(
  cwd: string,
  options: ResolveAcpCommandOptions
): string | undefined {
  const platform = options.platform ?? process.platform;
  const pathTools = platform === 'win32' ? path.win32 : path.posix;
  const candidate = pathTools.join(
    cwd,
    'node_modules',
    '@agentclientprotocol',
    'claude-agent-acp',
    'package.json'
  );
  const fileExists = options.fileExists ?? existsSync;
  return fileExists(candidate) ? candidate : undefined;
}

function resolvePackageBinPath(
  packageJsonPath: string,
  options: ResolveAcpCommandOptions,
  platform: NodeJS.Platform
): string {
  const packageJson = options.readPackageJson
    ? options.readPackageJson(packageJsonPath)
    : readPackageJson(packageJsonPath);
  const binRelativePath = getPackageBinPath(packageJson);
  const pathTools = platform === 'win32' ? path.win32 : path.posix;
  return pathTools.resolve(pathTools.dirname(packageJsonPath), binRelativePath);
}

function readPackageJson(packageJsonPath: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  return parsed;
}

function getPackageBinPath(packageJson: unknown): string {
  if (!isRecord(packageJson)) {
    throw invalidPackageBin('package.json is not an object');
  }

  const bin = packageJson.bin;
  if (typeof bin === 'string' && bin.trim() !== '') {
    return bin;
  }

  if (isRecord(bin)) {
    const packageBin = bin[CLAUDE_AGENT_ACP_BIN];
    if (typeof packageBin === 'string' && packageBin.trim() !== '') {
      return packageBin;
    }
  }

  throw invalidPackageBin(`package.json bin does not define ${CLAUDE_AGENT_ACP_BIN}`);
}

function invalidPackageBin(reason: string): AcpBinaryResolutionError {
  return new AcpBinaryResolutionError(
    `Unable to resolve ${CLAUDE_AGENT_ACP_BIN}; invalid ${CLAUDE_AGENT_ACP_PACKAGE} package metadata`,
    {
      attemptedPaths: [],
      binName: CLAUDE_AGENT_ACP_BIN,
      envVar: AEGIS_ACP_BIN_ENV,
      packageName: CLAUDE_AGENT_ACP_PACKAGE,
      reason,
    }
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSpawnableCommand(
  command: string,
  args: string[],
  source: AcpCommandSource,
  platform: NodeJS.Platform
): ResolvedAcpCommand {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args, source };
  }

  return {
    command: 'cmd.exe',
    args: [
      '/d',
      '/s',
      '/c',
      [quoteWindowsCmdArg(command), ...args.map(quoteWindowsCmdArg)].join(' '),
    ],
    source,
  };
}

function quoteWindowsCmdArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `"${value.replace(/(["^&|<>%])/g, '^$1')}"`;
}

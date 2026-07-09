/**
 * runner-profile.ts — Per-runner spawn configuration for the ACP backend.
 *
 * Phase 3.6 / ADR-0034: Aegis hosts any ACP-speaking coding-agent CLI behind
 * the same AcpBackend JSON-RPC machinery. Each profile owns the spawn seam —
 * binary resolution, auth env prefixes, the permission-mode strategy, and the
 * Claude-Code-specific guard flags — so AcpChildProcess can spawn the right
 * child per session without the protocol layer caring which CLI it is.
 * Claude Code is the default + reference; Kimi Code is the first additional
 * runner (native ACP, MIT).
 *
 * Why a profile and not the existing `AgentRunner` (src/runners/types.ts)?
 * AgentRunner models a raw-stdio process (readOutput → text chunks). ACP
 * needs duplex stdin/stdout for JSON-RPC, which AcpChildProcess already
 * provides. The profile parameterises only the SPAWN CONFIG AcpChildProcess
 * uses, so the entire ACP protocol layer is reused unchanged per runner.
 */

import {
  resolveClaudeAgentAcpBinary,
  type ResolveAcpCommandOptions,
  type ResolvedAcpCommand,
} from './binary-resolver.js';

export const CLAUDE_CODE_RUNNER = 'claude-code';
export const KIMI_RUNNER = 'kimi';

/** How a runner expects its effective permission mode to be applied. */
export type AcpPermissionModeStrategy =
  /** Claude Code: inject `--permission-mode <mode>` into argv at spawn. */
  | 'claude-code-argv'
  /** Runner governs permissions via ACP session/request_permission only. */
  | 'none';

/** Claude-Code-specific behaviours; OFF for non-CC runners (ACP-event-store-only). */
export interface AcpRunnerGuards {
  /** Patch `<workDir>/.claude/settings.local.json` before spawn (CC v2.1.143 override). */
  readonly patchClaudeSettings: boolean;
  /** Parse CC's `~/.claude/projects/` JSONL transcript format. */
  readonly parseClaudeTranscript: boolean;
  /** Shell out to `claude agents --json` for session discovery/reconciliation. */
  readonly claudeAgentsDiscovery: boolean;
}

/**
 * Per-runner spawn configuration consumed by AcpChildProcess.
 * Lets one AcpBackend host multiple ACP-speaking CLIs.
 */
export interface AcpRunnerProfile {
  readonly name: string;
  readonly defaultDisplayName: string;
  readonly resolveCommand: (options: ResolveAcpCommandOptions) => ResolvedAcpCommand;
  /** Env-var prefixes whose values are passed through to authenticate the runner. */
  readonly envPrefixes: readonly string[];
  readonly permissionModeStrategy: AcpPermissionModeStrategy;
  readonly guards: AcpRunnerGuards;
}

export class AcpRunnerProfileError extends Error {
  readonly code = 'AEGIS_ACP_RUNNER_UNKNOWN';
  constructor(message: string) {
    super(message);
    this.name = 'AcpRunnerProfileError';
  }
}

/** Kimi: resolve the `kimi` binary + `acp` subcommand. */
function resolveKimiBinary(options: ResolveAcpCommandOptions): ResolvedAcpCommand {
  const env = options.env ?? {};
  const explicit = options.explicitCommand?.trim();
  if (explicit) {
    return { command: explicit, args: ['acp'], source: 'explicit' };
  }
  const envBin = typeof env.AEGIS_KIMI_BIN === 'string' ? env.AEGIS_KIMI_BIN.trim() : '';
  if (envBin) {
    return { command: envBin, args: ['acp'], source: 'AEGIS_ACP_BIN', binName: 'kimi' };
  }
  return { command: 'kimi', args: ['acp'], source: 'AEGIS_ACP_BIN', binName: 'kimi' };
}

const CLAUDE_CODE_PROFILE: AcpRunnerProfile = {
  name: CLAUDE_CODE_RUNNER,
  defaultDisplayName: 'Claude Code',
  resolveCommand: resolveClaudeAgentAcpBinary,
  envPrefixes: ['ANTHROPIC_', 'CLAUDE_'],
  permissionModeStrategy: 'claude-code-argv',
  guards: {
    patchClaudeSettings: true,
    parseClaudeTranscript: true,
    claudeAgentsDiscovery: true,
  },
};

const KIMI_PROFILE: AcpRunnerProfile = {
  name: KIMI_RUNNER,
  defaultDisplayName: 'Kimi Code',
  resolveCommand: resolveKimiBinary,
  envPrefixes: ['KIMI_', 'MOONSHOT_'],
  permissionModeStrategy: 'none',
  guards: {
    patchClaudeSettings: false,
    parseClaudeTranscript: false,
    claudeAgentsDiscovery: false,
  },
};

const PROFILES: ReadonlyMap<string, AcpRunnerProfile> = new Map([
  [CLAUDE_CODE_PROFILE.name, CLAUDE_CODE_PROFILE],
  [KIMI_PROFILE.name, KIMI_PROFILE],
]);

/**
 * Resolve a runner profile by name. Falls back to Claude Code (the default +
 * hard-installed reference runtime) when name is undefined or blank. Throws
 * `AcpRunnerProfileError` for an unknown non-empty name.
 */
export function resolveAcpRunnerProfile(name: string | undefined): AcpRunnerProfile {
  const normalised = (name ?? '').trim();
  if (normalised === '') {
    return CLAUDE_CODE_PROFILE;
  }
  const profile = PROFILES.get(normalised);
  if (!profile) {
    throw new AcpRunnerProfileError(`Unknown ACP runner profile: ${normalised}`);
  }
  return profile;
}

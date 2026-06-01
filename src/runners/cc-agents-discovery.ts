/**
 * cc-agents-discovery.ts — Discover CC background sessions via `claude agents --json`.
 *
 * Issue #4028: CC v2.1.145 added `claude agents --json` for structured session
 * listing. This module provides a discovery layer that queries CC directly,
 * replacing tmux pane scraping for session state.
 *
 * The discovery is optional — if CC is too old or `claude` is not in PATH,
 * the module returns empty results and the caller falls back to tmux-based
 * discovery.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** A single CC background session from `claude agents --json`. */
export interface CcAgentSession {
  /** CC session ID (UUID). */
  id: string;
  /** Display name of the session. */
  name?: string;
  /** Working directory. */
  cwd?: string;
  /** Model in use. */
  model?: string;
  /** Current status (e.g. "running", "idle", "waiting_for_input"). */
  status?: string;
  /** ISO timestamp when the session was created. */
  createdAt?: string;
  /** Agent type (e.g. "claude-code"). */
  agentType?: string;
  /** Parent session ID for subagents. */
  parentSessionId?: string;
  /** PID of the CC process. */
  pid?: number;
  /** Arbitrary metadata from CC. */
  [key: string]: unknown;
}

/** Result of a discovery query. */
export interface CcAgentsDiscoveryResult {
  /** Whether the discovery was successful (CC found and --json supported). */
  available: boolean;
  /** Discovered sessions. Empty if not available. */
  sessions: CcAgentSession[];
  /** Error message if discovery failed. */
  error?: string;
  /** CC version string if detected. */
  ccVersion?: string;
}

/** Options for the discovery query. */
export interface CcAgentsDiscoveryOptions {
  /** Filter to sessions under this cwd. */
  cwd?: string;
  /** Timeout in ms for the claude agents command. Default: 10000. */
  timeoutMs?: number;
  /** Explicit path to claude binary. Default: auto-detect from PATH. */
  claudePath?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_CC_VERSION_FOR_AGENTS_JSON = '2.1.145';

/**
 * Parse a semver string into [major, minor, patch].
 * Returns null if the string is not valid semver.
 */
export function parseSemver(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Compare two semver tuples. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(
  a: [number, number, number],
  b: [number, number, number],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/**
 * Detect the installed CC version.
 *
 * @returns Version string (e.g. "2.1.146") or null if not found.
 */
export async function detectCcVersion(claudePath?: string, timeoutMs?: number): Promise<string | null> {
  const bin = claudePath || 'claude';
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], {
      timeout: timeoutMs ?? 5000,
      encoding: 'utf-8',
    });
    // Output format: "2.1.146 (Claude Code)" or "2.1.146"
    const match = stdout.trim().match(/^(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if the installed CC version supports `claude agents --json`.
 */
export async function isCcAgentsJsonSupported(claudePath?: string): Promise<boolean>;
export async function isCcAgentsJsonSupported(version: string, _claudePath?: string): Promise<boolean>;
export async function isCcAgentsJsonSupported(claudePathOrVersion?: string, _claudePath?: string): Promise<boolean> {
  const version = claudePathOrVersion?.match(/^\d+\.\d+\.\d+/) ? claudePathOrVersion : await detectCcVersion(claudePathOrVersion);
  if (!version) return false;
  const parsed = parseSemver(version);
  const minParsed = parseSemver(MIN_CC_VERSION_FOR_AGENTS_JSON);
  if (!parsed || !minParsed) return false;
  return compareSemver(parsed, minParsed) >= 0;
}

/**
 * Discover CC background sessions via `claude agents --json`.
 *
 * Returns a result object with:
 * - `available: true` + sessions if CC supports the command
 * - `available: false` + error if CC is missing or too old
 *
 * @param options - Discovery options (cwd filter, timeout, etc.)
 */
export async function discoverCcAgents(
  options: CcAgentsDiscoveryOptions = {},
): Promise<CcAgentsDiscoveryResult> {
  const bin = options.claudePath || 'claude';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Check version first
  const ccVersion = await detectCcVersion(bin, timeoutMs);
  if (!ccVersion) {
    return {
      available: false,
      sessions: [],
      error: 'claude binary not found in PATH',
    };
  }

  if (!await isCcAgentsJsonSupported(ccVersion, bin)) {
    return {
      available: false,
      sessions: [],
      error: `CC version ${ccVersion} does not support agents --json (requires >=${MIN_CC_VERSION_FOR_AGENTS_JSON})`,
      ccVersion,
    };
  }

  // Build args
  const args = ['agents', '--json'];
  if (options.cwd) {
    args.push('--cwd', options.cwd);
  }

  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB — large session lists
    });

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
      return { available: true, sessions: [], ccVersion };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        available: false,
        sessions: [],
        error: `Failed to parse claude agents --json output: ${trimmed.slice(0, 200)}`,
        ccVersion,
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        available: false,
        sessions: [],
        error: `Expected JSON array from claude agents --json, got: ${typeof parsed}`,
        ccVersion,
      };
    }

    const sessions = parsed.map((entry: Record<string, unknown>) => ({
      id: String(entry.id ?? entry.session_id ?? ''),
      name: entry.name != null ? String(entry.name) : undefined,
      cwd: entry.cwd != null ? String(entry.cwd) : undefined,
      model: entry.model != null ? String(entry.model) : undefined,
      status: entry.status != null ? String(entry.status) : undefined,
      createdAt: entry.created_at != null ? String(entry.created_at) : entry.createdAt != null ? String(entry.createdAt) : undefined,
      agentType: entry.agent_type != null ? String(entry.agent_type) : undefined,
      parentSessionId: entry.parent_session_id != null ? String(entry.parent_session_id) : undefined,
      pid: typeof entry.pid === 'number' ? entry.pid : undefined,
    }));

    return { available: true, sessions, ccVersion };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      sessions: [],
      error: `claude agents --json failed: ${message}`,
      ccVersion,
    };
  }
}

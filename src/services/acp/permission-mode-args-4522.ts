/**
 * permission-mode-args-4522.ts — Issue #4522 AC #3.
 *
 * Owns the --permission-mode argv injection logic and the
 * --dangerously-skip-permissions assertion. Extracted from
 * src/services/acp/child-process.ts to keep that file under the
 * gate:arch 500-line limit while we add the security boundary.
 */
import { StructuredLogger } from '../../logger.js';
import { AcpChildProcessStartError } from './acp-child-process-errors.js';
import type { ResolvedAcpCommand } from './binary-resolver.js';

const log = new StructuredLogger();

/** Valid Claude Code permission modes (mirrors hooks.ts VALID_PERMISSION_MODES). */
const VALID_PERMISSION_MODES: ReadonlySet<string> = new Set([
  'default', 'plan', 'bypassPermissions', 'acceptEdits', 'dontAsk', 'auto',
]);

function isValidPermissionMode(mode: string): boolean {
  return VALID_PERMISSION_MODES.has(mode);
}

/**
 * Issue #4522 AC #3: Inject `--permission-mode <mode>` into the resolved
 * command args so the CC child process cannot inherit a previously-supplied
 * permissive state across retire→wake cycles.
 *
 * Idempotent: if --permission-mode is already in args, do nothing.
 * Returns a new ResolvedAcpCommand (does not mutate the input).
 */
export function applyPermissionModeArgs(
  resolved: ResolvedAcpCommand,
  mode: string | undefined
): ResolvedAcpCommand {
  if (typeof mode !== 'string' || mode === '') {
    return resolved;
  }
  if (!isValidPermissionMode(mode)) {
    log.warn({
      component: 'acp-child-process',
      operation: 'invalidPermissionMode',
      attributes: { mode },
    });
    return resolved;
  }
  if (resolved.args.includes('--permission-mode')) {
    return resolved;
  }
  return {
    ...resolved,
    args: [...resolved.args, '--permission-mode', mode],
  };
}

/**
 * Issue #4522 AC #3: Defense-in-depth — reject any ACP spawn that includes
 * `--dangerously-skip-permissions` in argv. This is a hard security boundary;
 * the spawn must fail closed if this flag is present.
 */
export function assertNoDangerousArgs(
  resolved: ResolvedAcpCommand,
  cwd: string
): void {
  if (resolved.args.includes('--dangerously-skip-permissions')) {
    log.error({
      component: 'acp-child-process',
      operation: 'dangerousFlagDetected',
      attributes: { command: resolved.command, args: resolved.args },
    });
    throw new AcpChildProcessStartError({
      command: resolved.command,
      args: [...resolved.args],
      cwd,
      message:
        '--dangerously-skip-permissions is forbidden in ACP spawn args (Issue #4522 security boundary). ' +
        'Use --permission-mode <mode> instead.',
    });
  }
}

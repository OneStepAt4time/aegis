/**
 * permission-autoselect.ts — pick the permission option to auto-approve.
 *
 * Phase 3.6 / ADR-0034 + Issue #4689. ACP `session/request_permission`
 * requests carry the options the agent is offering (`params.options[].id`).
 * Different runners offer different option ids: Claude Code offers
 * 'allow-once' / 'allow-always'; Kimi Code offers 'approve' /
 * 'approve_for_session'. A hardcoded response optionId only works for the
 * runner whose vocabulary it matches — for others the agent rejects the
 * selection and the action (edit, command) is never applied, which surfaced
 * via dogfooding kimi through Aegis.
 *
 * pickAutoApproveOptionId reads the offered options and returns the best
 * allow-ish one (or the first offered, since auto-approve modes are
 * permissive by definition), falling back to 'allow-once' only when no
 * options were offered.
 */

const ALLOW_OPTION_PATTERN =
  /^(allow|approve|yes|allow[_-]once|allow[_-]always|approve[_-]for[_-]session|accept)$/;

/** Extract the offered option ids from a session/request_permission params blob. */
export function extractPermissionOptions(params: unknown): string[] {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return [];
  const options = (params as Record<string, unknown>).options;
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (typeof option === 'object' && option !== null && !Array.isArray(option)) {
        const id = (option as Record<string, unknown>).id;
        return typeof id === 'string' ? id : undefined;
      }
      return undefined;
    })
    .filter((id): id is string => typeof id === 'string');
}

/**
 * Pick the option id to send back for an auto-approved permission request.
 * Prefers an offered option whose id matches a known allow vocabulary;
 * otherwise the first offered option; otherwise 'allow-once' (Claude Code's
 * id, used when the request omits options).
 */
export function pickAutoApproveOptionId(params: unknown): string {
  const options = extractPermissionOptions(params);
  if (options.length === 0) return 'allow-once';
  const allowMatch = options.find((id) => ALLOW_OPTION_PATTERN.test(id));
  return allowMatch ?? options[0];
}

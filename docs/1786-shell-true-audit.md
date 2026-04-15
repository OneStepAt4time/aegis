# Audit: shell:true / exec() usage (start of work for #1786)

Date: 2026-04-15
Author: Hephaestus (ag-hep)

Summary
- Goal: audit code paths that execute shell commands or spawn child processes to identify any uses of `shell: true`, `exec()` with string interpolation, or other patterns that enable command injection.
- Priority: P1 security (as requested).

Findings (quick grep)
- Many modules use `execFile` / `execFileAsync` which is the preferred safer pattern (passes argv as array):
  - src/tmux.ts (execFileAsync used for tmux commands)
  - src/verification.ts (execFileAsync used for tsc/npm/test)
  - src/cli.ts (execFileSync with array args)
  - src/file-utils.ts (execFile for `icacls` on Windows)
  - src/process-utils.ts, src/swarm-monitor.ts, src/routes/sessions.ts use execFile/promisify patterns
- No direct occurrences of `shell: true` detected by quick grep.
- `execSync` is present in some scripts (e.g., scripts/uat-smoke.mjs uses execFileSync; CHANGELOG references historical replacement of execSync with execFileSync).

Risk areas to investigate
1. Inputs that become CLAUDE commands (`CreateSessionRequest.claudeCommand`) — these are user-supplied strings and could be included in tmux send-keys or used to build shell commands. Even when using execFile, passing user-controlled input into a command string (e.g., a single string to a shell) is dangerous.
2. Any code that concatenates command strings and calls `exec()` (none found by grep, but double-check manually for dynamic uses or indirect shell invocations).
3. Scripts and dev tooling (scripts/*.mjs) that use `execSync` or spawn with shell may be less protected and need review.

Recommendations / Next steps
1. Replace any remaining `exec()` or `spawn(..., { shell: true })` with `execFile()`/`spawn` without shell and array-style arguments. Where shell features are required, sanitize inputs thoroughly and avoid passing user-derived content.
2. Add unit tests that assert dangerous API paths (e.g., createSession with claudeCommand containing shell metacharacters) do not execute shell interpreters — mock `execFile` and `exec` to verify which one would be called.
3. Harden `CreateSession` input validation: treat `claudeCommand` as an argv array where possible, or explicitly disallow dangerous characters when the command will be routed to tmux send-keys or shell.
4. Add a CI lint rule or security check to detect `exec(` and `shell: true` usages in PRs.

Planned immediate actions (this PR)
- This PR adds this audit file as the initial work item for #1786. Next commits will:
  - Run a more exhaustive search for `exec(` patterns and list exact line numbers.
  - Propose targeted fixes for the highest-risk locations (e.g., any remaining `exec()` call sites, or verification of `claudeCommand` handling).


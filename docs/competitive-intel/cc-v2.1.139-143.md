# CC v2.1.139–v2.1.143 Competitive Intel — Aegis Impact Assessment

**Source:** Claude Code CHANGELOG — [anthropics/claude-code](https://github.com/anthropics/claude-code) releases v2.1.141, v2.1.142, v2.1.143 (May 11–15, 2026)
**Author:** Scribe (from Argus research brief #3534)
**Date:** 2026-05-16

---

## HIGH Impact

### 1. Background Session Flags (v2.1.142)

`claude agents` now accepts `--add-dir`, `--settings`, `--mcp-config`, `--plugin-dir`, `--permission-mode`, `--model`, `--effort`, and `--dangerously-skip-permissions`.

**Aegis impact:** Aegis spawns CC sessions via the ACP protocol. These new flags change the surface area of what can be configured per-session. We need to verify our hook-settings generation and session creation pass the right flags.

**Action:** Audit `src/services/acp/` to verify ACP spawn args cover all new flags. Add `--model`, `--effort`, `--permission-mode` passthrough from session creation params.

### 2. `worktree.bgIsolation: "none"` (v2.1.143)

New setting to let background sessions edit the working copy directly without `EnterWorktree`. Designed for repos where worktrees are impractical (large monorepos, restricted filesystems).

**Aegis impact:** Aegis manages CC sessions and worktrees. If CC users start disabling worktree isolation, our session management needs to handle the non-worktree path cleanly. `ag run` and session creation flows must handle `bgIsolation: "none"`.

**Action:** Verify session creation works when `bgIsolation: "none"` is set. Add documentation for how Aegis interacts with this setting. Related: #3539, #3541.

### 3. Worktree Cross-Boundary Edits (Bug #59628)

CC worktree sessions can edit files in the parent checkout with no guardrail — a sandboxing gap.

**Aegis impact:** Aegis sessions that use worktrees are potentially affected. Our session isolation should not rely solely on CC worktree enforcement.

**Action:** Document as known CC bug. Add troubleshooting note for users seeing unexpected file edits outside worktree scope. Verify Aegis `allowedWorkDirs` enforcement is independent of CC worktree boundaries.

---

## MEDIUM Impact

### 4. Projected Context Cost (v2.1.143)

`/plugin` marketplace now shows per-turn and per-invocation token estimates.

**Aegis impact:** Our cost tracking page (`/cost`) could surface similar projections. We already have cost tracking with burn rate and per-session cost. Adding token-estimate projections would differentiate Aegis for budget-conscious solo devs.

**Action:** Evaluate adding "estimated next-turn cost" to dashboard cost panel based on historical token patterns.

### 5. Stop Hook Block Cap (v2.1.143)

Stop hooks that block repeatedly now end the turn after 8 consecutive blocks. Configurable via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.

**Aegis impact:** Aegis injects HTTP hooks for CC sessions. If our hooks ever block (e.g., permission denied loop), this cap prevents infinite loops. We should ensure our hook responses never trigger this cap unintentionally.

**Action:** Verify Aegis hooks always respond within the block cap. Test: send 10+ sequential permission rejections and confirm CC doesn't end the turn prematurely.

### 6. `--cwd` Scoping (v2.1.141)

`claude agents --cwd <path>` scopes the session list to a directory.

**Aegis impact:** Our `ag list` and dashboard session list could benefit from directory-scoped session filtering.

**Action:** Consider adding `--cwd` filter to `ag list` and `GET /v1/sessions?workDir=` query param.

### 7. `terminalSequence` Hook Output (v2.1.141)

Hooks can now emit desktop notifications, window titles, and bells via `terminalSequence` in JSON output.

**Aegis impact:** Aegis hooks could use this to surface terminal-native feedback. Our Telegram notifications already cover this use case, but terminal-native feedback could improve the CLI UX for `ag run` users.

**Action:** Evaluate using `terminalSequence` in hook responses for `ag run` sessions.

### 8. Background Session Flag Preservation (v2.1.143)

`/bg` now preserves `--mcp-config`, `--settings`, `--add-dir`, `--plugin-dir`, `--strict-mcp-config`, `--fallback-model`, and `--dangerously-skip-permissions` across retire→wake cycles. Background sessions also preserve model and effort level after waking from idle.

**Aegis impact:** When Aegis resumes or reconnects a session, these flags are now preserved by CC itself. This reduces the configuration Aegis needs to re-inject on session resume.

---

## LOW Impact

### 9. Plugin Dependency Enforcement (v2.1.143)

CC now enforces plugin dependency chains. `disable` refuses when another enabled plugin depends on the target. `enable` force-enables transitive dependencies.

**Aegis impact:** We do not have a plugin system yet. If we ever add hooks/plugin support, this is the pattern to follow.

### 10. Fast Mode Default Model Change (v2.1.142)

Fast mode now defaults to Opus 4.7 (was Opus 4.6).

**Aegis impact:** Model selection is user-facing, but if we recommend or default fast mode anywhere, we should note the change.

### 11. Rewind "Summarize Up to Here" (v2.1.141)

New rewind menu option to compress earlier context while keeping recent turns.

**Aegis impact:** Internal CC feature. Worth noting for context window management docs, but no direct Aegis action needed.

---

## CC Bugs Aegis Should Track

| Bug | Description | Aegis Impact |
|-----|-------------|-------------|
| #59628 | Worktree cross-boundary edits — no guardrail | HIGH — session isolation |
| #59638 | Background agents crash exit 1 on macOS arm64 | MEDIUM — macOS users affected |
| #59626 | Image-only messages break sessions (cache_control error) | LOW — edge case, document as known CC bug |

---

## Recommendations

1. **Test Aegis against CC v2.1.143** — verify session creation, hook injection, and worktree handling still work with latest CC
2. **Add `bgIsolation: "none"` support** — ensure Aegis handles non-worktree background sessions gracefully
3. **Surface context cost projections** — leverage existing cost tracking to show per-turn estimates
4. **Document worktree cross-boundary bug** — add troubleshooting note for users seeing unexpected file edits
5. **Audit ACP spawn flags** — ensure new CC flags (`--model`, `--effort`, `--permission-mode`) are passed through
6. **Verify hook block cap** — test that Aegis hooks never trigger the 8-block termination

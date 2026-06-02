# RFC: #4522 — Hook bridge updates for CC v2.1.152

Status: Draft
Owner: Hephaestus (discord claim + issue comment)

Summary
-------
This RFC proposes the minimal, secure changes required to support Claude Code v2.1.152 hook bridge changes:

1. SessionStart response parsing: accept and act on `reloadSkills: true` and `hookSpecificOutput.sessionTitle` returned by hook handlers.
2. MessageDisplay hook event: register and forward `POST /v1/hooks/MessageDisplay`, accept hook responses that transform display text via `hookSpecificOutput`.
3. Permission-mode override (security boundary): ensure every CC spawn explicitly sets `--permission-mode <mode>` derived from the agent's effective permissions. Never inherit or forward `--dangerously-skip-permissions`.

Context
-------
Scribe's upstream scan (references/cc-upstream-impact-analysis.md) found that CC v2.1.152 exposes two hook-level surfaces that Aegis must support for compatibility and safety:
- SessionStart can return `reloadSkills` and `hookSpecificOutput.sessionTitle`.
- New MessageDisplay hook lets hooks transform or hide assistant output when displayed.

Separately, CC v2.1.143 introduced persistence for `--dangerously-skip-permissions` across retire→wake; Aegis must ensure it does not inherit that persisted permissive state.

Current state (code pointers)
-----------------------------
- Hook bridge (HTTP): `src/hooks.ts`
  - Known events list: `KNOWN_HOOK_EVENTS` (MessageDisplay missing)
  - Decision events: PreToolUse, PermissionRequest — response bodies used. SessionStart currently handled as a non-decision event and not returning the new fields.
- ACP runtime / spawn: `src/services/acp/child-process.ts` and `src/services/acp/backend/runtime.ts`
  - `permissionMode` exists and is passed through env as `AEGIS_PERMISSION_MODE` (acp-spawn-env.ts)
  - No explicit `--permission-mode` argv injection currently
- Permission guard: `src/permission-guard.ts` neutralizes `bypassPermissions` in CC settings files as a defense-in-depth

Design
------
Goals:
- Backwards compatible: unknown fields ignored by older CC versions
- Secure: prevent any path where CC's persisted permissive flag can be inherited without explicit agent intent
- Testable: provide a negative test that demonstrates the vulnerable variant fails

1) SessionStart response parsing
- Behavior: when `POST /v1/hooks/SessionStart` arrives, the hook bridge will gather the session and the validated hook body, then invoke registered handlers (existing flow).
- If a registered handler returns an object containing `reloadSkills: true`, Aegis will:
  - Trigger a skill rescan (same code path used for skill install flows), scoped to the session and without requiring a restart
  - Include `reloadSkills: true` in the response body returned to CC
- If the handler returns `hookSpecificOutput.sessionTitle` (string), Aegis will:
  - Update the session metadata.title in our session store
  - Include `hookSpecificOutput: { sessionTitle: <value> }` in the response to CC
- Tests: unit test for parsing + session metadata update; integration test driving real CC SessionStart → Aegis hook → Aegis returns `hookSpecificOutput.sessionTitle` → session loaded with proper title

2) MessageDisplay hook event
- Add 'MessageDisplay' to `KNOWN_HOOK_EVENTS` in `src/hooks.ts`.
- Treat MessageDisplay as a decision-like transform event: forward event body to hook handlers and accept `hookSpecificOutput` with a shape `{ message?: { text?: string, visible?: boolean, redactReasons?: string[] }}`
- Apply transforms according to policy:
  - If `visible === false` → suppress assistant message for display (still record transcript). This is sensitive — only allow for hooks we explicitly trust and require Themis sign-off.
  - If `message.text` present → replace display text with the provided value after deduplication + sanitization (strip control chars, disallow JS/CSS payloads)
- Tests: unit tests for whitelist handling and sanitization; real-CC e2e exercising transform

3) Permission-mode override (security boundary)
- Principle: every CC spawn must have explicit `--permission-mode` argv set based on the session's effective permissionMode (from session config / agent effective permissions).
- Implementation options:
  - Primary: inject `--permission-mode <mode>` into the resolved ACP command args in the resolver layer (binary-resolver.ts) or immediately before spawn in AcpChildProcessStart.
  - Defense-in-depth: keep permission-guard.ts (neutralize bypassPermissions in settings files) and set `AEGIS_PERMISSION_MODE` env var as before.
- Must ensure `--dangerously-skip-permissions` is NEVER added to argv. Add assertions / tests enforcing this.
- Negative test: a test that simulates the vulnerable code path (no `--permission-mode` injection) should fail the assertion that `--dangerously-skip-permissions` is absent or that effective permissionMode is set.

Threat model (high level)
-------------------------
- Attacker goal: get Aegis to spawn CC with persistent permissive mode so tools run without user consent, or to hide/alter assistant output via MessageDisplay.
- Attack vector 1: compromised hook that returns `hookSpecificOutput` with message transforms to hide errors — partially mitigated by sanitization + Themis review + allowlist for hooks that can hide text.
- Attack vector 2: CC persisted `--dangerously-skip-permissions` across retire/wake; if Aegis doesn't set fresh `--permission-mode` on spawn, the child inherits the previously-supplied permissive CLI flag. Mitigation: always set argv `--permission-mode` and never pass `--dangerously-skip-permissions`.

Code path traces (implementation plan)
-------------------------------------
- SessionStart:
  1. `POST /v1/hooks/SessionStart` -> `registerHookRoutes` in `src/hooks.ts`
  2. validate payload via zod -> `deps.eventBus.emitHook(sessionId, 'SessionStart', hookBody)`
  3. Wait for/collect hook handler response (if we have an async handler invocation path) -> parse `reloadSkills` + `hookSpecificOutput.sessionTitle`
  4. If reloadSkills -> call `skills.rescan()` (existing skill manager path). If sessionTitle -> call `sessionService.updateTitle(sessionId, title)`
  5. Return response to CC including `hookSpecificOutput` and top-level `reloadSkills` where applicable

- MessageDisplay:
  1. Add to `KNOWN_HOOK_EVENTS`
  2. forward to handlers via `eventBus.emitHook`
  3. accept `hookSpecificOutput` -> sanitize -> send to SSE/clients for display layer application

- Permission-mode argv injection:
  1. At runtime spawn point (`AcpChildProcess.resolveCommand` / `createResolver`), inject `--permission-mode <mode>` into the resolved args.
  2. Add unit test & integration test that inspects the resolved command args for presence of `--permission-mode` and absence of `--dangerously-skip-permissions` after retire→wake flows.

Test plan
---------
- Unit tests:
  - `hooks` unit tests to assert MessageDisplay is accepted in `KNOWN_HOOK_EVENTS` and that SessionStart responses with new fields are parsed.
  - `permission-guard` and child-process tests: assert that resolved command args include `--permission-mode` for each spawn.
  - Negative test: run a variant where `--permission-mode` injection is disabled and assert test fails (this proves the negative case).
- Integration / e2e tests:
  - Real CC session: start a CC session connected to local Aegis, emit SessionStart with a hook that returns sessionTitle and reloadSkills; assert session title set and skill rescan occurred; run MessageDisplay with transform and assert transformed message shows in display layer.
- Gate: `npm run gate` must pass on branch before merge. The PR body will include the full `npm run gate` output link in the evidence pack.

Acceptance criteria
-------------------
- Unit tests added and passing for new parsing, event registration, and argv injection checks.
- Integration e2e transcript attached demonstrating SessionStart + MessageDisplay path.
- Negative test that fails on the vulnerable variant.
- `npm run gate` clean run attached.
- Code changes reviewed and Themis pre-review sign-off on permission-mode security design.

Open questions for Themis
------------------------
- For MessageDisplay: do we allow `visible: false` to fully suppress assistant messages, or restrict to transformations only? Recommendation: disallow suppression by default; allow only with explicit security justification and Themis sign-off.
- For `reloadSkills`: is a synchronous immediate rescan acceptable (current plan), or do you prefer deferred rescan (background task) to avoid blocking SessionStart? Recommend immediate but gated by size/time limits.

Timeline
--------
- Draft PR with RFC + scaffolding (this PR): now — initiating pre-review.
- Implementation & tests: follow-up commits on this branch within next few hours.


# HEARTBEAT.md — Hephaestus Dev Loop (SHORT)

## Purpose
Hephaestus (Hep) develops Aegis using Aegis. Use the local Aegis MCP server (http://localhost:9100) for all development sessions. Keep this heartbeat short and strictly actionable.

## Professional execution standard
- Treat Claude Code via Aegis as an interactive workflow, not a one-shot prompt.
- Use in-session Claude Code commands for iterative delivery; check in-session help (for example `/help`) when needed.
- Use Claude Code via Aegis as the implementation engine, not as an autopilot.
- Review every Claude Code output critically before accepting it.
- Reject low-quality or unsafe output and request refinements in-session.
- Never ship unverified code: session evidence must include typecheck, build, and tests.

---

## Absolute rule (short)
Do NOT perform OS-level remediation: no systemctl/pkill/tmux kills. Manage sessions only via the Aegis API. If you need operator intervention, notify ops and Boss.

## Mandatory bootstrap guard (run before heartbeat)
Before the heartbeat loop starts, read the required local context files. This is mandatory.

```bash
cd /home/bubuntu/.openclaw/workspace-aegis
cat SOUL.md USER.md OPERATIONAL-RULES.md IDENTITY.md AGENTS.md
cat memory/$(date +%Y-%m-%d).md 2>/dev/null || true
cat memory/$(date -d 'yesterday' +%Y-%m-%d).md 2>/dev/null || true
cat state/current-task.json 2>/dev/null || true
```

If required context is missing, stop and escalate before running any session action.

---

## Every heartbeat (5–10 min)

1) Check Aegis health
- Command: `curl -sS http://localhost:9100/health`
- If health.status != "ok": post a one-line alert to #aegis-devs and open a GitHub issue with the infra template including the health output and timestamp. Do NOT restart or kill services yourself.

2) Handle active sessions (blocking)
- List sessions: `curl -s http://127.0.0.1:9100/v1/sessions | jq '.sessions[] | {id,status,lastActivity}'`
- If a session is WAITING FOR INPUT (assistant asked a question): reply via `POST /v1/sessions/<ID>/send` immediately.
- If a session is STALLED (>5 min no transcript change):
  a) send_message: `"Continue — what's blocking you?"`
  b) if no progress: `POST /v1/sessions/<ID>/interrupt`
  c) if still stalled: `DELETE /v1/sessions/<ID>` and create a fresh session with a refined brief
- Always use the Aegis API to manage sessions; never kill OS processes.

3) Start the next task via MCP
- Pick one ready/assigned issue (label: `ready` or highest priority). If none → triage with Athena.
- Create a CC session including the full issue URL in the prompt: `https://github.com/OneStepAt4time/aegis/issues/N`.
- Wait 8–12s for CC to boot and verify `promptDelivery.delivered`/status.
- **Permission approvals:** Do NOT auto-approve. Approve only with a 1–2 line justification recorded in the transcript. If Claude Code requests OS-level changes (systemctl, pkill, etc.), **do not approve** — escalate to Boss immediately.
- Instruct Claude Code to run mandatory verification before any PR: `tsc --noEmit && npm run build && npm test` (or project equivalents). Attach full output in PR body.

Prompt example (single prompt):
"Implement issue #N — https://github.com/OneStepAt4time/aegis/issues/N — create worktree at ../wt/issue-N, run build & tests, attach output in PR body, open PR if green."

4) If a Claude Code session stalls or fails (after ~3 attempts)
- **Do NOT attempt manual infra fixes or OS-level remediation.**
- Capture session id and full transcript.
- Post to Discord #aegis-devs: brief title, last visible steps, session id. Attach transcript.
- Open a GitHub issue using the official template. Include: environment, commit SHA, steps to reproduce, session id, full transcript, last known state.
- **Escalate immediately:** tag Argus and Boss. They will triage and decide next steps.

5) If you find a bug or failing tests
- Capture session id and transcript (attach or paste excerpt).
- Post to Discord #aegis-devs: one-line title, reproduction steps, session id, attach transcript/logs.
- Open a GitHub issue using the official template. Minimum: title, env/commit SHA, steps to reproduce, expected vs actual, transcript/logs, session id. Add labels: `bug` + priority.
- If P0 or blocking CI → @mention Boss and Argus on Discord.

6) On success
- Post a one-line update to #aegis-devs: "Hep: done #<issue> — PR/commit/issue link"
- Update project board (move card, add PR link) and kill the session.

---

## Rules (TL;DR)
- Team operations: English only.
- Always include session id and transcript when reporting bugs.
- Use the official issue template (no free-form bug reports).
- Keep heartbeat status messages concise (1–3 lines).
- Always work on git Worktrees for isolation. Never modify the main working tree (Never edit code in /home/bubuntu/projects/aegis). For every issue create an isolated worktree and branch (e.g. `../wt/issue-123`); you don't have to do it yourself — ask Claude Code via Aegis to create and manage it.
- When you start working on an issue, always send the issue link to Claude Code in the initial prompt so it has full context.
- Use Claude Code skills and commands to perform better code management, like creating branches, making commits, opening PRs, etc. Always ask Claude Code to do these tasks for you instead of doing them manually.
- Always execute tests and build commands via the Aegis session, never run them manually on the terminal. Ask Claude Code to perform them (unit, smoke, integration, and QA tests; you can ask Claude Code to coordinate a team of agents to do that). This ensures all outputs are captured in the session transcript for debugging and accountability.

Status message example (single-line preferred):
**Team Status**
- Hep: working on #123 — implemented X; tests failing on Y — opened issue #456

---

## PR Requirements & Safety Guarantees

### PR Metadata (required in body)
Every merged PR must include:
- **Aegis server version:** output of `curl -s http://localhost:9100/health | jq .version`
- **Commit SHA:** head commit of the branch
- **Session ID:** Aegis session that performed the work
- **Verification output:** paste full `tsc --noEmit && npm run build && npm test` output

Example:
```
## Verification
Aegis API: v1.2.3-rc1
Commit: a1b2c3d
Session: uuid-xxxxx
Tests: ✓ 42 passed
Build: ✓ Success
```

### Secrets & Security
- **Never commit secrets** (API keys, tokens, passwords, credentials).
- If a secret is discovered in a commit:
  1. Rotate immediately (revoke old credentials, generate new ones).
  2. Open a private security issue (label: `security`) and notify ops.
  3. Escalate to Boss privately on Discord.
  4. Do NOT post details to public Discord channels.

### Operational Recommendations
- **Worktree convention:** Always use `../wt/issue-{N}` for consistency (e.g. `../wt/issue-1234`).
- **Pre-push guards:** Recommend setting up a pre-push hook or CI check to:
  - Prevent commits directly to `main` or `master`.
  - Enforce branch naming (e.g., `feat/`, `fix/`, `docs/`).
  - Example: `.git/hooks/pre-push` can reject pushes to protected branches.
- **CI enforcement:** Block merges if tests fail or if build verification is missing.

---

## Self-Improving Check (every heartbeat)
1. Read `~/self-improving-ag-hep/corrections.md` — any unaddressed corrections?
2. Read `~/self-improving-ag-hep/memory.md` — any patterns/rules applicable to current work?
3. If a lesson applies to the active task, apply it. If a correction is unaddressed, address it now.
4. Update `~/self-improving-ag-hep/heartbeat-state.md` with timestamp and result.

## Proactivity Check (every heartbeat)
1. Read `~/proactivity-ag-hep/session-state.md` — is there an active task with a clear next move?
2. Read `~/proactivity-ag-hep/heartbeat.md` — any recurring follow-ups due?
3. If a task is blocked and the blocker is known, attempt one pivot before escalating.
4. If a follow-up is due, execute it. Update log.
5. Leave one clear next move in `~/proactivity-ag-hep/session-state.md` before the heartbeat ends.

---

## When to escalate to Boss / Ema (on discord you can tag Ema with <@1471632276478492824>)
- Critical P0 incidents that block CI or production
- OS-level changes or infrastructure requests (do not attempt automatic remediation)
- Any blocker you can't resolve after 2 pivots
- Security issues or secrets discovered in commits
- Release promotions that require operator action


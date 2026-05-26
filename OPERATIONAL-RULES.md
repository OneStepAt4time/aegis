# Operational Rules — Hephaestus

> Canonical team rules. English only. Read every heartbeat.
> If this file disagrees with the repo (`AGENTS.md`, `ROADMAP.md`, `.claude/rules/`), **the repo wins**.

## Mantra
**They rest, we build.** Nothing stops us.

## Non-Negotiable Rules
- Never go silent when stuck — tag whoever can unblock you (Boss / Argus / Ema).
- Always use Discord IDs (not display names) when tagging.
- Never tell the team "go to sleep" or dismiss another agent's work.
- English only for all in-team artifacts (docs, commits, PRs, Discord ops channel).
- Italian only with Ema directly, when explicitly asked.
- Read `IDENTITY.md`, `SOUL.md`, `AGENTS.md`, and this file before any task. Re-read on every heartbeat.
- Respect scope: never step into another agent's ownership without an explicit handoff.

## Heartbeat Checklist (every cycle)
1. **PR status** — check CI runs, pending reviews, merge conflicts on your branches.
2. **Assigned issues** — update progress in the issue thread; mark blockers out loud.
3. **Blockers** — surface immediately to Boss; do not sit on them for more than one heartbeat.
4. **HEARTBEAT.md** — append what you did, what's next, any blocker.

## Team Roster (9 agents)
| Name | Role | Discord ID |
|------|------|-----------|
| Boss | Orchestrator (workspace-main) | 1494004694803153058 |
| Argus | Code Reviewer & Merge Gatekeeper | 1490089830472880218 |
| Athena | Project Manager & Triage Lead | 1490090121679339814 |
| Daedalus | Frontend — Aegis Dashboard | 1490092150950465698 |
| Hephaestus | Backend — Aegis Server | 1490089546099069048 |
| Scribe | Documentation | 1490090420321910804 |
| Themis | Security Auditor | 1494469266060087368 |
| Hermes | Release / DevOps | 1494469941074591924 |
| Orpheus | DevRel / Community | 1494469505647382549 |
| Ema (human) | Product Owner | 1471632276478492824 |

> Discord IDs marked **TBD** must be requested from Ema before first Discord ping.

## Escalation Path
- **Routine / coordination / unblock:** Boss (orchestrator).
- **Strategy / scope / product:** Ema (human product owner).
- **Code review / merge gate:** Argus.
- **Security incident:** Themis (own bridge to Ema for disclosures).
- **Release / CI failure on `main`:** Hermes.

Escalate upward the moment a task exceeds your scope — never sideways without cc'ing Boss.

## Bug Reporting (Ema's Rule)
When you find a bug while building Aegis:
1. **Open a GitHub issue** using the official template.
2. **Maximum detail:** write as if for someone who has never used a computer. Repro steps, expected vs actual, environment, logs.
3. **Actionable:** the issue must be detailed enough that any other agent can pick it up and resolve it without asking questions.
4. **Sign it** at the bottom with your agent name.

## Anti-patterns (instant violation)
- Pushing directly to `main` (only Hermes promotes `develop` → `main`).
- Using `--no-verify` or bypassing `npm run gate`.
- Opening a PR that targets `main` instead of `develop` (unless declared hotfix).
- Shipping docs / marketing copy for features that are not merged.
- Duplicating another agent's work — if unsure, ask in Discord before starting.

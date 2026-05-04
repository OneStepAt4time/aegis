# ACP-106: tmux Reference Audit — Files Requiring Rewrite

> Tracking document for #2626 (lifecycle docs alignment) and #2625 (doctor,
> deployment, Helm, Windows setup cleanup).

This audit catalogs every file in the repository that references tmux, psmux, or
tmux-specific concepts. Files are grouped by rewrite priority.

## Priority 1 — Full Rewrite Needed (10+ tmux references)

These files have the highest tmux density and need complete review and rewrite
for the ACP cutover.

| File | tmux refs | Notes |
|------|-----------|-------|
| `docs/DISASTER_RECOVERY.md` | 31 | Recovery procedures reference tmux attach, pane capture, socket inspection. Replace with ACP event replay, terminal debug, and action APIs. |
| `docs/enterprise/01-architecture.md` | 22 | Architecture diagrams and descriptions reference tmux transport layer. Rewrite around ACP backend, SessionService, Postgres/Redis. |
| `docs/migration-guide.md` | 18 | v0.5→v0.6 guide references tmux socket, tmux sessions. Add ACP migration section or separate ACP guide (see `docs/acp-migration-guide.md`). |
| `docs/api-reference.md` | 14 | Documents pane endpoint, tmux fields in responses, tmux health. Remove pane endpoint, update field tables. |
| `docs/architecture.md` | 13 | High-level architecture references tmux as transport. Rewrite for ACP control plane. |
| `docs/onboarding.md` | 12 | Setup instructions reference tmux installation and configuration. Replace with ACP dependency checks. |
| `docs/troubleshooting.md` | 11 | Troubleshooting steps reference tmux attach, pane inspection, socket issues. Replace with ACP diagnostics. |
| `docs/windows-development.md` | 10 | Windows-specific psmux instructions. Remove entirely — ACP is cross-platform. |
| `docs/enterprise/00-gap-analysis.md` | 9 | Gap analysis references tmux limitations as context. Update for ACP era. |
| `docs/adr/0014-multi-line-message-sending-via-tmux.md` | 9 | tmux-specific ADR. May be superseded or archived — multi-line sending works differently with ACP. |
| `docs/SCALING.md` | 8 | Scaling docs reference tmux session limits and socket management. Rewrite for ACP process management. |
| `docs/enterprise/03-testing-observability.md` | 8 | Test/observability docs reference tmux-based testing. Update for ACP test patterns. |
| `docs/SECURITY_QUESTIONNAIRE.md` | 7 | Security questionnaire references tmux attack surface. Update for ACP security model. |
| `docs/enterprise.md` | 7 | Enterprise docs reference tmux in deployment sections. Update for ACP + Postgres + Redis. |

## Priority 2 — Partial Update Needed (3-9 tmux references)

| File | tmux refs | Notes |
|------|-----------|-------|
| `README.md` | 10+ | Prerequisites, architecture diagram, config examples, quick start. Update prerequisites (remove tmux, add claude-agent-acp note). Update architecture section. |
| `CLAUDE.md` | 4 | Architecture section, dependency list. Already partially updated in #2630. |
| `CONTEXT.md` | 12+ | Architecture, conventions, codebase tour. Rewrite architecture section. |
| `EXTERNAL_DEPLOYMENT_GUIDE.md` | 10+ | External deployment references tmux as prerequisite. Remove, add Postgres/Redis requirements. |
| `PRODUCTION_DEPLOYMENT.md` | 10+ | Production setup references tmux configuration. Replace with ACP + Postgres + Redis setup. |
| `SECURITY.md` | TBD | Security controls reference tmux command injection prevention. Already partially updated in #2630. |
| `AGENTS.md` | TBD | Agent rules reference architecture. Already partially updated in #2630. |
| `ROADMAP.md` | TBD | Roadmap references tmux in Phase 3.5 section. Already partially updated in #2630. |
| `CONTRIBUTING.md` | 2 | Minor tmux references in setup instructions. |
| `skill/SKILL.md` | 2 | Skill file references tmux for session management. |

## Priority 3 — Root-Level Config/Meta Files

| File | Notes |
|------|-------|
| `package.json` | May have tmux-related scripts or peer dependencies. |
| `.claude/rules/` | Scoped rules may reference tmux in architecture or workflow descriptions. |
| `.github/workflows/` | CI workflows may install or check tmux. Remove. |
| `deploy/helm/` | Helm chart may include tmux-related configuration or health checks. |

## Priority 4 — Source Code (for reference only — not Scribe's domain)

These files contain tmux implementation code that will be deleted as part of the
M5 cutover. Listed here for completeness so docs can reference the removal.

| File | Purpose |
|------|---------|
| `src/tmux.ts` | Core tmux adapter — will be deleted |
| `src/terminal-parser.ts` | TUI state inference from terminal capture — will be retired |
| `src/vt100-screen.ts` | ANSI terminal buffer normalization — may be retained for debug |
| `src/pty-stream.ts` | pipe-pane realtime streaming — will be retired |
| `src/ws-terminal.ts` | WebSocket tmux pane stream — will be rewritten |
| `src/session.ts` | Session management with windowId/windowName — will be refactored |
| `src/monitor.ts` | Pane/window health polling — will consume event stream |

## Audit Methodology

```bash
# Count tmux references per file
grep -rn 'tmux\|psmux\|windowId\|windowName\|paneCommand\|capture.pane\|send.keys\|pipe.pane' \
  --include='*.md' docs/ | \
  awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

## Status

- [ ] Priority 1 files: pending rewrite
- [ ] Priority 2 files: pending partial update
- [ ] Priority 3 files: pending review
- [ ] Priority 4 files: Hep's domain — track for deletion in M5

## Related Issues

- #2610 (ACP-067) — ACP migration guide ✅ drafted
- #2625 — Doctor, deployment, Helm, Windows setup cleanup
- #2626 (ACP-106) — Lifecycle docs alignment
- #2631 — ACP major cutover release plan ✅ merged
- #2630 — Phase 3.5 activation ✅ merged

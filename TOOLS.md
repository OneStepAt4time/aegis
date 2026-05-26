# TOOLS — Hephaestus

> Backend / Aegis Server developer toolbox. Aegis runs locally; Hep talks to it via the Aegis HTTP/MCP API on `localhost:9100`.

## Aegis Server (the bridge / control plane)
- **Endpoint:** `http://localhost:9100`
- **Health:** `curl -s http://localhost:9100/v1/health | jq`
- **OpenAPI:** `http://localhost:9100/openapi.yaml`
- **Auth:** API key via `Authorization: Bearer <token>` header. Token lives in `~/.aegis/config.json` (NOT in shell history).
- **MCP entry:** `claude mcp add aegis -- npx @onestepat4time/aegis mcp`.

## tmux — Aegis manages its own panes
- Aegis creates per-session tmux panes named `aegis-<session-id>`.
- Hep does NOT manually attach to or kill those panes.
- For Hep's own shell work: ad-hoc tmux sessions (e.g., `tmux new -s hep-work`).

## Aegis Repo (read-only by default)
- Local clone: `~/projects/aegis` (DO NOT edit code here).
- Always work on a worktree: `git -C ~/projects/aegis worktree add ../wt/issue-<N> -b fix/<N>-short origin/develop`.
- Worktree convention: `~/projects/aegis-worktrees/wt-<N>` or `../wt/issue-<N>`.

## Quality Gate (mandatory before any PR)
```
npm ci
npm run gate
```
Runs typecheck + build + tests. If it fails, fix or escalate to Boss — never push with `--no-verify`.

## Branch Conventions
- All standard PRs target `develop`.
- `main` is release/promotion only (managed by Hermes / Argus).
- Branch naming: `fix/<N>-short`, `feat/<N>-short`, `refactor/<N>-short`, `docs/<topic>`, `chore/<topic>`.

## Useful Commands
| What | Command |
|------|---------|
| List sessions | `curl -s -H "Authorization: Bearer $AEGIS_TOKEN" http://localhost:9100/v1/sessions \| jq` |
| Server logs | `journalctl --user -u aegis -f` |
| API version | `curl -s http://localhost:9100/v1/health \| jq .version` |
| Open PR | `gh pr create --base develop --title "..." --body-file PR_BODY.md` |

## What Hep does NOT do
- No `systemctl`, `pkill`, OS-level remediation. Escalate to Boss.
- No auto-approve permission requests in Aegis sessions — only with 1-2 line written justification.
- Never push to `main`.
- Never edit code in `~/projects/aegis` directly — always a worktree.

## Proactive Tool Use
- Prefer safe internal work, drafts, checks, and preparation before escalating
- Use tools to keep work moving when the next step is clear and reversible
- Try multiple approaches and alternative tools before asking for help
- Use tools to test assumptions, verify mechanisms, and uncover blockers early
- For send, spend, delete, reschedule, or contact actions, stop and ask first
- If a tool result changes active work, update `~/proactivity-ag-hep/session-state.md`

## Repository Source of Truth
See AGENTS.md banner at the bottom of that file.

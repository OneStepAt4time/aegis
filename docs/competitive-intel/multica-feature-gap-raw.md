# Multica vs Aegis — Feature Gap Analysis

> Generated 2026-05-22 by Hermes. Source: Multica v0.3.5 source code + CLI testing.

## Summary

**Multica** is a full-stack, multi-agent task management platform (Go + Next.js + PostgreSQL) where agents and humans share the same project board. **Aegis** is a Claude Code orchestration middleware (Node.js/Fastify) that wraps ACP sessions behind an API, with MCP, webhooks, and a dashboard.

They serve overlapping but different markets. Multica is a "Linear for AI agents"; Aegis is a "session control plane for Claude Code."

---

## Feature Gap Table

| # | Feature | Multica | Aegis | Gap (what Aegis is missing) |
|---|---------|---------|-------|------------------------------|
| **Agent Management** |
| 1 | Agent profiles / identities | Agents have named profiles, appear on the board, have avatars, distinct styling (robot icon, purple badge) | No concept of agent profiles; sessions are anonymous tasks | Aegis has no persistent agent identity system. Every session is a one-off. |
| 2 | Agent assignment to issues | Issues are assigned to specific agents (or humans) via assignee picker, polymorphic `assignee_type` | No issue/task assignment concept; sessions are created programmatically | Aegis lacks any task-level agent assignment workflow. |
| 3 | Squads (agent groups) | Group agents under a leader; assign work to `@FrontendTeam`; leader delegates to the right member | No squad/grouping concept | Aegis has no team-based agent routing or delegation. |
| 4 | Agent auto-detection | Daemon auto-detects 11+ CLIs on PATH (claude, codex, copilot, openclaw, opencode, hermes, gemini, pi, cursor-agent, kimi, kiro-cli) | Detects `claude` / `claude-agent-acp` only | Aegis only supports Claude Code. No multi-runtime detection. |
| 5 | Per-agent model override | Each agent CLI can have a custom model (`MULTICA_CLAUDE_MODEL`, `MULTICA_CODEX_MODEL`, etc.) | Model override per session via `--model` flag, but only for Claude | Aegis has no multi-provider model routing at the daemon level. |
| **Task Lifecycle** |
| 6 | Issue/Task board (Kanban-style) | Full board view with statuses: backlog → todo → in_progress → in_review → done → blocked → cancelled | No task board. Sessions have states (working/idle/killed) but that's session state, not task lifecycle | Aegis has no kanban-style task management. Sessions are ephemeral. |
| 7 | Issue creation via CLI | `multica issue create --title --description --priority --assignee` | No issue creation concept; sessions are created via API/CLI but lack task metadata | Aegis cannot create or track "issues" as first-class objects. |
| 8 | Issue priorities | Urgent, high, medium, low priorities on issues | No priority system on sessions | Aegis has no prioritization mechanism. |
| 9 | Issue metadata KV store | Per-issue key/value metadata (pipeline_status, pr_number, etc.); queryable via `--metadata key=value` | No per-session metadata KV store (only Memory Bridge for cross-session context) | Aegis lacks structured, queryable task metadata. |
| 10 | Issue comments / threaded discussions | Full comment system with threads, replies, pagination, threading cursors | No comment/discussion system on sessions | Aegis sessions have transcripts but no human-agent discussion threads. |
| 11 | Issue subscribers / notifications | Subscribe to issues; get notified on status changes, comments | Notification via Telegram/Slack/webhooks for session events, but no per-task subscription model | Aegis lacks per-task subscription/notification preferences. |
| 12 | Execution history / runs | `multica issue runs` — list all past executions for an issue, view messages per run, incremental polling | Session history API exists, but sessions are not grouped under a parent "issue" | Aegis has no concept of re-running the same task with full run history. |
| 13 | Projects / epics | Group issues into projects with status, lead, icon; filter by project | No project/epic grouping | Aegis has no project or work-stream organization. |
| **Collaboration** |
| 14 | Human + AI teammates on same board | Humans and agents share the same board, same assignment flow, same activity timeline | Aegis is single-user; no multi-user or multi-agent collaboration on a shared board | Aegis has no multi-user collaboration surface. |
| 15 | Activity timeline | Full activity feed per issue/workspace showing who did what and when | Session event stream (SSE) but no unified activity timeline across sessions | Aegis has no cross-session activity timeline. |
| 16 | Reactions / emoji on comments | `reaction.go` handler — reactions on issues and comments | No reaction system | Aegis has no social/reaction features. |
| 17 | Mentions / @-tagging | Mention agents or humans in comments; triggers notifications | No mention/tagging system | Aegis has no mention system. |
| 18 | Issue labels | Label system for categorizing issues (`label.go`) | No labeling system | Aegis has no categorization/tagging for sessions. |
| 19 | Pinned items | Pin issues for visibility (`pin.go`) | No pinning | Aegis has no pinning feature. |
| **CLI** |
| 20 | One-command setup | `multica setup` — configures, authenticates, starts daemon in one step | `ag init` + `ag run` is close, but requires manual auth setup | Aegis's `ag run` is similar but doesn't match the full zero-config daemon flow. |
| 21 | CLI daemon management | `multica daemon start/stop/status/logs` — persistent background daemon | `ag` starts a server, but it's not a daemon; no `daemon logs`, no PID management | Aegis has no daemon mode with background process management. |
| 22 | CLI profiles | Multiple daemon profiles on same machine (staging, production) with separate config dirs | No profile system | Aegis has no multi-profile support. |
| 23 | CLI workspace management | `multica workspace list/switch/get` — multi-workspace from CLI | No workspace concept in CLI | Aegis CLI has no workspace commands. |
| 24 | CLI self-update | `multica update` — auto-detects install method and upgrades | No self-update command | Aegis has no built-in update mechanism. |
| 25 | CLI issue operations | Full CRUD for issues, comments, metadata, subscribers, status changes — all from CLI | No issue CRUD from CLI | Aegis CLI only manages sessions, not tasks. |
| **Dashboard** |
| 26 | Desktop app (Electron) | Full Electron desktop app with tabs, workspace isolation, native window chrome | Web dashboard only (localhost:9100/dashboard) | Aegis has no desktop app. |
| 27 | Board view | Kanban board with columns for each status | Session list/table view — no kanban | Aegis has no kanban board. |
| 28 | Inbox / notification center | `inbox.go` handler — unified notification inbox per user | No inbox/notification center in dashboard | Aegis has no notification center in the dashboard. |
| 29 | Settings → Runtimes page | Dashboard for managing connected runtimes, seeing which CLIs are available | No runtime management page | Aegis has no runtime management UI. |
| 30 | Settings → Agents page | Dashboard for creating and managing agent profiles | No agent management UI | Aegis has no agent configuration UI. |
| **Multi-Workspace / Multi-Tenancy** |
| 31 | Workspace isolation | Multiple workspaces, each with own agents, issues, settings; `X-Workspace-ID` header routing | Multi-tenancy via API key `tenantId` — but no workspace isolation in the UI or CLI | Aegis has tenant IDs but no true workspace isolation with separate boards. |
| 32 | Workspace membership | Members belong to workspaces; `workspace member list`; invitation system (`invitation.go`) | No membership model — just API key access | Aegis has no user membership or invitation system. |
| 33 | Workspace switching | `multica workspace switch` — change active workspace from CLI | No workspace switching | Aegis has no workspace switching. |
| **Skills / Knowledge** |
| 34 | Reusable skills | Every solution becomes a reusable skill; `skill.go`, `skill_create.go` handlers; skills compound across agents | No skills system; Aegis has a structured learnings system (#3413) but it's internal-only | Aegis has no reusable, shareable skill system for agents. |
| 35 | Skill import from URL | `multica skill import` — pull skills from ClawHub, skills.sh, or GitHub | No skill import mechanism | Aegis has no skill marketplace or import system. |
| 36 | Per-agent skill assignment | Assign specific skills to specific agents (`agent skills` command) | No skill-to-agent mapping | Aegis has no skill assignment concept. |
| **Autopilots / Automation** |
| 37 | Autopilots (scheduled tasks) | Create scheduled or webhook-triggered automations: `multica autopilot create --mode create_issue --agent "CodeReviewer" --schedule "0 9 * * 1"` | No autopilot/scheduled agent execution | Aegis has no scheduled task execution for agents. |
| 38 | Autopilot triggers | Schedule triggers (cron) and webhook triggers per autopilot | No trigger system | Aegis has no trigger-based automation. |
| 39 | Autopilot run history | `multica autopilot runs` — track all past autopilot executions | No automation history | Aegis has no automation execution history. |
| **Real-time / Streaming** |
| 40 | WebSocket real-time updates | Full real-time events via Redis pub/sub + WebSocket (sharded relay mode) | WebSocket terminal streaming exists, but event system is SSE-based | Aegis lacks a unified real-time event bus comparable to Multica's sharded Redis relay. |
| 41 | Agent heartbeat / liveness | Runtime heartbeat tracking (`runtime_liveness_store.go`); dead runtime detection | Health check endpoint but no runtime heartbeat/liveness tracking | Aegis has no runtime liveness tracking. |
| **Deployment** |
| 42 | Self-hosted Docker Compose | Full docker-compose with PostgreSQL + Redis + API + Web + Daemon | Dockerfile exists but no docker-compose for full stack | Aegis has no docker-compose for self-hosted deployment. |
| 43 | Cloud offering | Multica Cloud (hosted SaaS) with CloudFront CDN, managed infra | No cloud/SaaS offering | Aegis is self-hosted only. |
| 44 | Desktop app distribution | Electron app packaged for macOS/Windows/Linux | Web dashboard only | Aegis has no desktop app. |
| **Security** |
| 45 | PAT (Personal Access Tokens) | `mul_` prefixed tokens with expiry, last-used tracking, caching | API keys with RBAC but no PAT system with expiry | Aegis has API keys but no personal access tokens with expiry. |
| 46 | CSRF protection | Cookie-based auth with CSRF token validation for state-changing requests | No CSRF protection (API-only auth) | Aegis lacks CSRF protection (less critical for API-only auth). |
| 47 | Workspace-scoped permissions | Per-workspace role-based access control with member roles | Global RBAC with `viewer`/`admin` roles | Aegis has no workspace-scoped permissions. |
| **Integrations** |
| 48 | GitHub integration | Server-side GitHub App: webhook receiver, issue sync, PR creation from agent work | No server-side GitHub integration (CLI-only via `gh`) | Aegis has no server-side GitHub webhook/app integration. |
| 49 | Webhook delivery tracking | `webhook_delivery.go` — delivery history, retry logic, status tracking | Webhooks exist but no delivery tracking/retry | Aegis has no webhook delivery tracking. |
| 50 | Email notifications | `server/internal/service/email.go` — email service for notifications | No email notifications | Aegis has no email notification system. |
| **Internationalization** |
| 51 | i18n / multi-language | Full i18n with Chinese, English, and more locales | Dashboard i18n in progress (EN/IT) | Aegis i18n is early stage. |
| 52 | CLI language detection | Chinese README, CLI responds to locale | CLI is English-only | Aegis CLI is English-only. |

## What Aegis Has That Multica Doesn't

| Feature | Aegis | Multica |
|---------|-------|---------|
| MCP (Model Context Protocol) tools | 12+ native MCP tools for agent control | No MCP integration |
| Cost tracking / analytics | Per-session cost tracking, budget enforcement, cost charts | Token usage tracking per runtime, but no budget enforcement or cost analytics dashboard |
| OTel tracing | OpenTelemetry integration for distributed tracing | No OTel/tracing integration |
| ACP (Agent Control Protocol) | Native ACP support with pause/resume/intervention | No ACP — uses its own task lifecycle protocol |
| Telegram/Slack/Discord channels | Multi-channel notification (Telegram, Slack, Discord, etc.) | No multi-channel notification (email + in-app only) |
| Session export | Export transcript as JSONL or Markdown | No session/export concept (issues have run history but no export) |
| Audit trail | Full audit log for compliance | No explicit audit trail feature |
| RBAC with strictRBAC | Role-based access with optional strict mode even when auth is disabled | Workspace-scoped roles but no strictRBAC equivalent |
| Budget enforcement | Hard budget limits with enforcement status endpoint | No budget enforcement |
| Solo-dev zero-config | `ag init` + `ag run` zero-config localhost mode | Requires server setup even for local use |
| Helm chart | Kubernetes deployment via Helm | Docker Compose only |

## Strategic Implications

### Multica's Moat
1. **Multi-agent orchestration** — squads, task assignment, agent profiles. This is fundamentally a different product category (project management for AI teams).
2. **Vendor-neutral runtime support** — 11+ CLI runtimes auto-detected. Aegis is Claude Code only.
3. **Community scale** — 30.7K stars, 3.7K forks in ~4 months. Massive velocity.
4. **Skills marketplace** — reusable, composable agent skills that compound team capabilities.
5. **Self-hosted + Cloud** — both deployment models with PostgreSQL + Redis backing.

### Aegis's Moat
1. **MCP tooling** — only product with native MCP for agent control. Strong for integration-heavy workflows.
2. **Cost analytics** — budget enforcement, cost tracking, spend dashboards. Enterprise differentiator.
3. **ACP native** — deep Claude Code ACP integration (pause/resume/intervention). Deeper than Multica's task lifecycle.
4. **Multi-channel notifications** — Telegram, Slack, Discord, etc. Multica only has email + in-app.
5. **Solo-dev simplicity** — zero-config localhost mode. Multica requires full stack even for local use.
6. **Helm/Kubernetes** — enterprise deployment path. Multica is Docker Compose only.

### Recommended Strategic Response
1. **Short-term (Phase 3-4):** Don't try to match Multica feature-for-feature. Lean into depth over breadth.
2. **Key gaps to close:** Skills system, agent profiles, execution history (re-run tasks), webhook delivery tracking.
3. **Differentiators to amplify:** MCP tooling, cost analytics, multi-channel notifications, solo-dev UX.
4. **Multi-runtime support** is the existential threat — if Multica normalizes "use any CLI agent," being Claude-only becomes a liability.

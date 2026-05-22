# Multica v1 Battle Card

> Generated 2026-05-22 by Orpheus (DevRel). Updated 2026-05-22 with strategic review by Boss, Argus, Daedalus.
>
> **Threat level: 🟡 MEDIUM** (downgraded from 🟡 HIGH per Boss + Argus review — architecture mismatch limits real overlap)

## Executive Summary

**Multica** (30.7K ⭐, 3.7K forks, v0.3.5) is a Go + Next.js + PostgreSQL multi-agent task management platform. It's a "Linear for AI agents" — agents and humans share a project board, assign tasks, comment, and ship code. 11 CLI runtimes supported.

**Aegis** is a Node.js/Fastify Claude Code orchestration middleware — a "session control plane" with REST API, MCP tools, cost analytics, and web dashboard.

**They are not the same product.** But they overlap enough that every feature Multica ships that Aegis doesn't becomes a competitive comparison point for prospects evaluating agent orchestration tools.

---

## Feature Matrix

| Category | Multica | Aegis | Advantage |
|----------|---------|-------|-----------|
| **Agent profiles** | Named profiles, avatars, per-agent config | Sessions are anonymous one-offs | 🟢 Multica |
| **Squads / teams** | Agent groups with leader delegation | No grouping | 🟢 Multica |
| **Multi-runtime** | 11 CLIs auto-detected | Claude Code only | 🟢 Multica (existential) |
| **Task board** | Kanban with full lifecycle | No task concept | 🟢 Multica |
| **Issue management** | Full CRUD, priorities, metadata KV, labels | No issues | 🟢 Multica |
| **Comments / threads** | Full threaded discussions | Transcripts only | 🟢 Multica |
| **Projects / epics** | Group issues into projects | No project grouping | 🟢 Multica |
| **Skills system** | Reusable, composable, importable | Learnings (internal only) | 🟢 Multica |
| **Autopilots** | Cron + webhook triggered automations | No scheduled tasks | 🟢 Multica |
| **Execution history** | Re-run tasks, full run log | Session history, no re-run | 🟢 Multica |
| **Desktop app** | Electron (macOS/Win/Linux) | Web only | 🟢 Multica |
| **Multi-workspace** | Full workspace isolation + switching | API key tenantId, no UI isolation | 🟢 Multica |
| **Workspace membership** | Roles, invitations, member list | API key access only | 🟢 Multica |
| **CLI daemon** | Background daemon with logs/status | Server process, no daemon mode | 🟢 Multica |
| **CLI profiles** | Multiple profiles (staging/prod) | Single config | 🟢 Multica |
| **CLI self-update** | `multica update` | No self-update | 🟢 Multica |
| **Inbox / notifications** | Unified notification inbox | No notification center | 🟢 Multica |
| **GitHub integration** | Server-side webhook + PR creation | CLI-only via `gh` | 🟢 Multica |
| **Email notifications** | Resend / SMTP | None | 🟢 Multica |
| | | | |
| **MCP tools** | None | 12+ native MCP tools | 🔵 Aegis |
| **Cost analytics** | Token usage only | Budget enforcement + cost dashboards | 🔵 Aegis |
| **ACP native** | Custom task protocol | ACP with pause/resume/intervention | 🔵 Aegis |
| **OTel tracing** | None | OpenTelemetry integration | 🔵 Aegis |
| **Multi-channel notifications** | Email + in-app only | Telegram, Slack, Discord, etc. | 🔵 Aegis |
| **Audit trail** | None | Structured audit logs | 🔵 Aegis |
| **RBAC depth** | owner/admin/member | viewer/admin + strictRBAC | 🔵 Aegis |
| **Budget enforcement** | None | Hard limits + enforcement status | 🔵 Aegis |
| **Helm / K8s** | Docker Compose only | Helm chart for Kubernetes | 🔵 Aegis |
| **Solo-dev UX** | Requires full stack | Zero-config localhost | 🔵 Aegis |
| **Session export** | None | JSONL + Markdown export | 🔵 Aegis |

**Score: Multica leads 19 categories. Aegis leads 11 categories.**

---

## Moat Analysis

### Multica's Moat (hard to replicate quickly)
1. **Multi-runtime support** — 11 CLIs auto-detected. This is the existential threat. If the market normalizes "use any agent CLI," being Claude-only becomes a liability.
2. **Squads + leader delegation** — Complex routing logic with strategy modes. Non-trivial to build.
3. **Skills marketplace** — Network effect: more skills = more value for all agents.
4. **Community scale** — 30.7K stars in ~4 months. Velocity compounds.
5. **Full task lifecycle** — Kanban board, priorities, metadata, comments, labels, subscribers. This is project management infrastructure.

### Aegis's Moat (hard for Multica to replicate)
1. **MCP tooling** — 12+ native tools. Multica has no MCP integration at all.
2. **ACP depth** — Pause/resume/intervention is deeper than Multica's task lifecycle.
3. **Cost analytics + budget enforcement** — Enterprise feature. Multica has no enforcement.
4. **Multi-channel notifications** — Telegram/Slack/Discord. Multica is email+in-app only.
5. **Solo-dev zero-config** — `ag init` + `ag run` is simpler than Multica's full-stack setup.
6. **OTel + Helm** — Enterprise observability and deployment. Multica has neither.

---

## Multica's Weaknesses (Our Attack Surface)

1. **No audit trail** — Zero audit logging. Unacceptable for enterprise compliance.
2. **No budget enforcement** — No spend limits. Enterprise deal-breaker.
3. **No MCP** — Can't integrate with MCP ecosystem. Growing liability.
4. **No multi-channel notifications** — Email + in-app only. Teams live in Slack/Discord.
5. **No OTel** — No distributed tracing. Ops blind spot.
6. **JWT hardcoded dev secret** — `multica-dev-secret-change-in-production` as fallback. Foot-gun.
7. **Backend runs as root** — No `USER` directive in Dockerfile.
8. **No API rate limiting on auth** — Brute force potential.
9. **No branch protection visible** — We're fixing ours (#3949, #3950), they aren't.
10. **Requires full stack** — PostgreSQL + Redis + server + daemon. Heavy for solo devs.

---

## Recommended Strategic Response

### Tier 1 — Close This Quarter (existential gaps)
| Gap | Effort | Impact | Issue |
|-----|--------|--------|-------|
| Multi-runtime support (Codex, Gemini, OpenCode) | Large | Existential | New |
| Agent profiles / persistent identities | Medium | High | New |
| Reusable skills system | Medium | High | New |
| Execution history (re-run tasks) | Small | Medium | New |

### Tier 2 — Close Next Quarter (competitive gaps)
| Gap | Effort | Impact | Issue |
|-----|--------|--------|-------|
| Task board / kanban view | Large | High | New |
| Issue management (CRUD, priorities, labels) | Large | High | New |
| Autopilots (scheduled agent tasks) | Medium | Medium | New |
| Desktop app (Electron) | Large | Medium | Deferred |
| CLI daemon mode | Medium | Medium | New |
| CLI self-update | Small | Low | New |

### Tier 3 — Amplify Our Advantages
| Advantage | Action |
|-----------|--------|
| MCP tooling | Double down. Ship more MCP tools. Make Aegis the MCP-first agent platform. |
| Cost analytics | Add forecasting, team budgets, alerting. Enterprise differentiator. |
| Multi-channel | Add email notifications to match Multica, keep our Telegram/Slack/Discord edge. |
| Solo-dev UX | Market this aggressively. "Zero-config agent orchestration in 30 seconds." |
| OTel + Helm | Enterprise sales enablement. "Production-ready observability and deployment." |

---

## Key Metrics Comparison

| Metric | Multica | Aegis |
|--------|---------|-------|
| GitHub Stars | 30,700 | ~150 |
| Forks | 3,730 | ~30 |
| Language | Go + TypeScript | TypeScript |
| Database | PostgreSQL + Redis | SQLite (default) |
| Runtime support | 11 CLIs | 1 (Claude Code) |
| CLI commands | ~50 | ~10 |
| Dashboard pages | ~20 | ~10 |
| Test coverage | High (Go + TS) | Medium |
| License | Apache 2.0 | MIT |
| First release | ~Jan 2026 | ~Oct 2025 |
| Release cadence | ~weekly | ~biweekly |

---

## Bottom Line

Multica is a **different product category** (project management for AI agents) that's eating into Aegis's potential market (agent orchestration). Their multi-runtime support is the existential threat — if agents become vendor-neutral, Claude-only is a constraint, not a feature.

**Aegis should NOT try to match Multica feature-for-feature.** We should:
1. Close the multi-runtime gap (Codex, Gemini, OpenCode support)
2. Build agent profiles + skills (compound value)
3. Double down on MCP, cost analytics, and enterprise features (our moat)
4. Market solo-dev simplicity aggressively (their weakness)

The window is open. Multica has no MCP, no audit trail, no budget enforcement, no multi-channel notifications. These are enterprise table stakes that Aegis already has. Ship these harder while closing the runtime gap.

---

## Strategic Review — 2026-05-22

### Source Assessment (Orpheus)

- **Architecture:** B+ — Clean Go separation (Chi + sqlc + pgx/v5), Go 1.26.1, typed SQL via sqlc, test culture (PRs cite test counts — 748 frontend, 387 core)
- **CLI UX:** 8/10 — Polished Cobra CLI, clear `multica <noun> <verb>` pattern, profile isolation, cross-platform (brew/curl/PowerShell)
- **Security:** C+ — Email-only auth (good), PAT + daemon tokens, but no SECURITY.md, no formal audit trail, rate limiting optional/fail-open, default JWT secret weak, no SSO/SAML/OIDC
- **Community:** B+ — 31K stars (~180/day), 4 core contributors (3 at ~800+ commits each), bus factor of 4
- **License:** Modified Apache 2.0 — NOT OSI-approved. Source-available with commercial restrictions (can't offer as hosted SaaS without license). Aegis's MIT license is clearer for community.
- **Release cadence:** v0.1.0 (Jan 15) → v0.3.5 (May 21) = 6 releases, accelerating. v0.3.5 had 925 downloads in <24h.

### Boss's Strategic Direction

- **Correct framing:** Horizontal (broad but shallow) vs vertical (narrow but deep). Multica's moat is operational UX. Aegis's moat is enterprise governance.
- **Don't chase breadth** — correct today, but not forever. Squads and autopilots are on our roadmap for a reason. Phase 4, after enterprise depth is solid.
- **925 downloads in 24h** — signal, not panic. Keep shipping velocity high.
- **Task queue (#3970)** stays high priority — validate the spec, get Hep on it when current work clears.
- **Orphan sweeper (#4004)** — foundation for reliability. Argus already spec'd it.

### Argus's Threat Assessment (#3969)

- Downgraded from 🟡 HIGH to 🟡 MEDIUM
- Architecture mismatch limits real overlap
- Our moat (dashboard, security, audit, cost, approvals) is defensible
- Their moat (Squads, multi-runtime) is standard patterns already on our roadmap
- **Strategic response:** ship quality, not feature parity
- Most of Multica's "P0" features already in Aegis's roadmap or codebase
- Only new gap found: orphan action recovery (#4004, P2)

### Daedalus's Dashboard Analysis

**In scope (adopt clean-room):**
- Agent Profiles (#3971, P1) — keystone feature, prerequisite for everything else
- Skills System (#3979, P2) — compounding knowledge is a genuine differentiator
- Task Queue (#3970, P2) — retry/resume valuable but not blocking

**Out of scope (don't adopt):**
- Comments & @Mentions (#3978) — scope creep, we use GitHub issues
- Autopilots (#3972) — already handled by our cron + webhook system
- Squads (#3973) — too early, needs Agent Profiles + multi-session proven first

**Our moat to invest harder in:**
- Dashboard — they have zero web UI
- Approval workflows — fully autonomous agents vs our human-in-the-loop gates
- Audit trail — no competitor at our depth

### Summary: Strategic Response

1. **Double down on enterprise governance** — auth, audit, RBAC, cost tracking. That's the moat enterprises pay for.
2. **Ship task queues** (#3970) — the one gap that matters operationally.
3. **Build Agent Profiles** (#3971) — the keystone for everything downstream (skills, squads).
4. **License clarity is an advantage** — MIT vs their source-available Modified Apache 2.0.
5. **Keep shipping velocity high** — 925 downloads in 24h is a signal.

# Aegis Competitive Threat Matrix

> **Last updated:** 2026-05-15 | **Source:** Issues #3013, #3014, #3016, #3003, #3004, #3216, #3236 + ECC analysis (Orpheus) + deep competitive research (Scribe)
> **Audience:** Leadership (Ema, Boss) for strategic planning

---

## Executive Summary

The Claude Code orchestration space is **crowded and moving fast**. 10+ competitors with 200×–470× Aegis's star count. The market is bifurcating into **simple developer tools** (win on ease-of-use) and **enterprise platforms** (win on depth and governance). Aegis is an enterprise platform — the moat is real but the **simplicity gap is existential**.

**Bottom line:** We cannot out-feature ruflo (47K ⭐, 98 agents, 314 MCP tools). We cannot out-simplify oh-my-claudecode (33K ⭐, zero-config install). We *can* own the **enterprise orchestration middleware** niche — API-first, compliant, auditable — if we close the install friction gap and ship multi-agent support.

**Strategic window:** 3-6 months. After that, Ruflo's 47K-star community and OMC's 33K-star plugin marketplace distribution will make organic discoverability nearly impossible without paid marketing.

---

## Threat Matrix

| Rank | Competitor | ⭐ | Threat | Installs in | Agent count | Chat platforms | API | Dashboard | Enterprise auth |
|------|-----------|-----|--------|-------------|-------------|---------------|-----|-----------|----------------|
| #1 | **Ruflo** | 49.3K (+2.3K in 3 days) | 🔴 CRITICAL | `npx ruflo init` | 98 | UI only | ✅ (undocumented) | ✅ (beta) | ❌ |
| #2 | **oh-my-claudecode** | 33.5K (+400 in 3 days) | 🔴 CRITICAL | `/plugin install` (1 cmd) | Multi-agent | Plugin (inside CC) | ❌ | ❌ | ❌ |
| #3 | **cc-connect** | 8K | 🟠 HIGH | Binary download | 10+ | **11** (inc. WeChat, QQ) | ❌ | ✅ (basic) | Token only |
| #4 | **Composio** | 6.9K | 🟠 HIGH | `npm install` | Multi-agent | CI/CD focus | ✅ | ❌ | ❌ |
| #5 | **open-multi-agent** | 6.1K | 🟡 MEDIUM | `npm install` | Multi-agent | MCP only | ✅ | Tracing UI | ❌ |
| #6 | **mission-control** | 4.7K | 🟠 HIGH | `npm install` | Multi-gateway | Skills Hub | ✅ | ✅ | ✅ RBAC |
| #7 | **OpenACP** | 346 | 🟠 HIGH | `curl \| bash` | **28+** | Telegram, Discord, Slack | ✅ | ❌ | ❌ |
| #8 | **ECC** | 177K | 🟢 OPPORTUNITY | Config library | N/A (skills) | N/A | ❌ | ❌ | ❌ |
| #9 | **ClaudeClaw** | 1 | 🟡 MEDIUM | `curl \| bash` | 1 (CC hooks) | Telegram | ❌ | ❌ | ❌ |
| #10 | **Verdent AI** | N/A (closed) | 🟠 HIGH | Mac app download | Parallel agents | Telegram, Slack | ❌ | Desktop app | ❌ |
| #11 | **Roo Code** | ~~30K~~ 💀 | ⬛ DEAD | — | — | — | — | — | — | Shut down May 15, 2026. IDE-first tool killed by platform shift. |
| #12 | **Cline** | 61K | 🟡 MEDIUM | VS Code ext + Kanban + CLI | 1+ (Kanban workers) | UI only | ✅ SDK (`@cline/sdk`) | 🟢 Kanban board | SSO, 3-tier RBAC, OTel, prompt storage (Enterprise) |
| — | **ccusage-dashboard** | 1 | 🟢 ADJACENT | Self-hosted | N/A (analytics) | N/A | ❌ | 9-panel React | ❌ |
| — | **Aegis** | ~200 | — | `npx + ag run` (2 cmds) | 1 (Claude Code) | 4 | ✅ 34 MCP tools | ✅ Full React | ✅ OIDC/RBAC |

---

## Aegis-Only Features (Our Moat)

No single competitor has ALL of these. This is the enterprise wedge:

- ✅ Full REST API (65+ endpoints) with CRUD + pagination
- ✅ MCP server (34 tools)
- ✅ SSE real-time event streaming
- ✅ OIDC/SSO enterprise auth + RBAC roles
- ✅ Audit trail with hash chain integrity
- ✅ OpenTelemetry tracing
- ✅ Billing/metering with cost tracking
- ✅ TypeScript + Python client SDKs
- ✅ Kubernetes / Helm deployment
- ✅ Sigstore release signing
- ✅ Session templates + pipeline orchestration
- ✅ Memory Bridge (cross-session state)
- ✅ Session export (JSONL download)

---

## Critical Gaps (What Competitors Have That We Don't)

| Gap | Impact | Who has it | Priority |
|-----|--------|-----------|----------|
| **Multi-agent support** | Existential — every competitor supports 2+ agents | All except ECC | P0 |
| **Simple install** (≤2 commands) | Users never reach Aegis if OMC is easier | OMC, OpenACP, Ruflo | P0 |
| **Plugin marketplace distribution** | 177K-star audience unreachable | OMC (CC marketplace) | P1 |
| **Chat platform breadth** | Missing entire Asian market (WeChat, QQ, DingTalk) | cc-connect (11 platforms) | P1 |
| **Natural language scheduling** | Dev productivity killer feature | cc-connect | P2 |
| **Project memory** | Adoption — users want persistent context across sessions | Verdent AI, Ruflo | P1 |
| **Parallel agent execution** | Adoption — every prosumer competitor has it | Verdent AI, cc-connect, Ruflo | P0 |
| **Self-learning memory** | Agents improve over time | Ruflo | P2 |
| **Multi-language docs** | International adoption blocked | OMC (6 languages), cc-connect (5) | P2 |

---

## Strategic Recommendations

### Immediate (v0.7.0)
1. **Close the install gap** — `ag run "task"` is a start. Make it the default. Zero-config should be 1 command, not 4.
2. **Multi-agent support** — at minimum, add Codex and Gemini as runner backends (ACP already supports them)
3. **ACP registry listing** — register Aegis for discoverability

### Short-term (v0.8.0)
4. **Claude Code plugin marketplace** — get Aegis listed as a plugin, not just an npm package
5. **ECC integration guide** — "Run ECC Skills as a Service with Aegis" captures their 177K-star audience
6. **Discord channel** — cc-connect has it, we don't

### Medium-term (v1.0)
7. **Asian market** — WeChat, QQ, DingTalk adapters
8. **Natural language scheduling** — "every Monday at 9am, run tests"
9. **Multi-language docs** — at minimum EN + ZH + JA

### Defensive Positioning
> **"ECC makes your agents smart. Aegis makes them accessible."** — Orpheus

This is the tagline. Ruflo and OMC are developer tools. Aegis is **enterprise middleware** — the layer between "someone typed a message" and "code shipped to production." The moat is compliance, governance, observability. Don't compete on agent count. Compete on trust.


## Market Pulse — 2026-05-15

**Roo Code shuts down (May 15, 2026):** Roo Code (~30K stars, 3M+ downloads, SOC2 Type 2) shut down today. All products (Extension, Cloud, Router) sunsetting. They explicitly recommend Cline as replacement and are pivoting to roomote.dev (unclear direction). IDE-first tool killed by platform shift.
- **Lesson:** Being model-agnostic isn't enough (Roo had that). SOC2 compliance alone doesn't save a product. 3M extension downloads doesn't guarantee survival. Server-side middleware survives platform shifts.
- **Action:** Don't invest more analysis. Monitor roomote.dev. Roo users migrating now — Cline is the primary beneficiary.

**Cline Enterprise launching (61K stars, Apache 2.0):** Cline is the dominant open-source AI coding agent (VS Code, JetBrains, Cursor, Neovim). Enterprise layer includes SSO, 3-tier RBAC (Member/Admin/Owner), model/tool controls, OpenTelemetry export, usage tracking, and prompt storage to S3/R2. Also shipping Kanban (parallel task execution) and a CLI for headless/CI automation.
- **Key distinction:** Cline = client-side governance (settings pushed to IDEs). Aegis = server-side control (central API gateway with interception, audit, permission queues). Not direct competitors today — complementary. Aegis could theoretically wrap Cline.
- **Risk:** If Cline expands to server-side governance, they become a direct competitor. Monitor closely.
- **Distribution advantage:** 61K stars, VS Code marketplace presence, `@cline/sdk`. They reach devs before we do.

**Strategic note:** Aegis is Claude Code only today, but server-side architecture means we could theoretically wrap any agent runtime in future phases. No positioning change — this is an internal option, not external messaging.

**Verdent AI (proprietary, Mac-only):** Mac-native conversation-first platform. Key differentiator: Plan Mode (natural language → structured parallel task plans). Published SEAlign at ICSE 2026 (Distinguished Paper). Added Eco Mode, BYOK, PAYG pricing recently. Targets individual devs, not enterprise.
- **First-run gap:** Verdent's 4-step onboarding (download → sign in → describe task → watch) beats our empty dashboard experience. Recommendation: add "Getting Started" card to OverviewPage when sessions < 3.
- **Task decomposition:** Kanban shows parent-child tasks with real-time parallel execution. Aegis has no equivalent — but this is Phase 4 scope (Session Groups / Workflow View).
- **What we beat them on:** Web-first (any OS), RBAC + audit, multi-tenant, PWA, open source (MIT), persistent named agents.
- **What we should NOT copy:** Conversation-first UI (our users want data/control), Mac-only, consumer pricing, ephemeral workers, AI-generated dashboards.

## Market Pulse — 2026-05-12

Live star counts and release velocity as of May 12:

| Competitor | ⭐ Today | 3-day delta | Latest release | npm installs/week | Ship cadence |
|-----------|---------|-------------|----------------|-------------------|-------------|
| **Ruflo** | 49,305 | +2,300 | v3.7.0-alpha.23 (May 11) | 56,915 | Multiple/day (alpha) |
| **oh-my-claudecode** | 33,491 | +400 | v4.13.7 (May 9) | 7,341 | Weekly |
| **Aegis** | ~10 | — | v0.6.7 (May 11) | 162 | 5–10 PRs/day |

**Key signals:**
- Ruflo gained 2,300 stars in 3 days — accelerating. Still pre-stable (alpha releases).
- OMC grew 400 stars — steady. On v4.13.7 with stable weekly releases.
- Aegis npm installs: 162/week. Ruflo: 56,915/week (351× our volume). OMC: 7,341/week (45× our volume).
- Ruflo shipped 15+ alpha releases between May 6–11. Velocity is extreme.

**Takeaway:** The install friction gap is costing us real users. Ruflo's `npx ruflo init` and OMC's `/plugin install` capture developers before they discover Aegis. PR #3232 (2-command quickstart docs) addresses this at the docs level. The code-level simplification (#3181) needs Ema's product direction.

---

### oh-my-claudecode — Critical Path
- **12 features we lack:** autopilot mode, multi-agent team orchestration (plan→PRD→exec→verify→fix), cross-model advisor (/ccg), deep interview (Socratic requirements), skill learning system, smart model routing (30-50% token savings), HUD statusline, magic keyword triggers, persistent verify/fix loops, tmux CLI workers, multi-language docs (7 languages)
- **Their moat:** plugin marketplace = built-in discovery. "Don't learn Claude Code. Just use OMC." executes our positioning better than we do.
- **Not direct competitors:** OMC is a Claude Code plugin (dev tool). Aegis is a standalone service (infrastructure). They serve different buyers. Risk is OMC captures devs before they discover Aegis.
- **Top action:** reduce install to `npm i -g aegis && ag run` (2 commands). Then plugin marketplace listing.

### Ruflo — AI Operating System
- **20 features we lack:** 100+ agents, 314 MCP tools, 32-plugin system, swarm coordination (hierarchical/mesh/adaptive), self-learning SONA neural patterns, federated agent comms, Rust-based vector engine (HNSW, 150x faster), GOAP goal planner (A*), web UI (flo.ruv.io), 12 background workers, browser automation (Playwright), security audit plugin, WASM sandboxed agents, IoT management, neural trading, cost tracker plugin, ADR management, DDD scaffolding
- **Their moat:** self-learning compounds — the more you use Ruflo, the smarter it gets. Rust engine is an infrastructure moat. 47K-star gravity.
- **Their weakness:** zero compliance story. No OIDC, no audit trail, no K8s, no supply-chain security. They're a dev tool, not enterprise infrastructure.
- **Positioning:** complement, not compete. "Aegis as the API gateway that makes Ruflo-style agents production-safe."

### Full Landscape — Strategic Threats
- **Simplicity trap:** devs find OMC/OpenACP first, never discover Aegis. Counter: 2-command install + marketplace listing.
- **Breadth race:** Ruflo covers Aegis's entire feature set + 10x more. Counter: don't compete on breadth, lean into security/compliance/audit.
- **Convergence:** cc-connect adding our features (lifecycle hooks, auth, custom prompts). Counter: ship enterprise features faster.
- **Aegis is the ONLY project** with all 6 enterprise pillars: K8s + OIDC + audit trail + OTel + Sigstore + SDKs.

### Recommended Positioning
> **"Run any AI agent. Ship with confidence."**
>
> Aegis = enterprise-safe orchestration middleware. The layer between AI agents and production requirements.
> Not the AI OS (Ruflo's lane). Not the simplest dev tool (OMC's lane). The middleware that makes AI agents production-grade: secure, auditable, observable, compliant.

---

## Two-Way Comparison: Counter-Moves

For each competitor: what they have that we don't **AND** what we have that they can't easily replicate.

### vs. Ruflo (47K ⭐)

| They have (our gaps) | We have (their gaps) | Why they can't replicate easily |
|---------------------|---------------------|-------------------------------|
| 100+ specialized agents | REST API (65+ endpoints) | Plugin architecture is CLI/MCP-first, not HTTP. Adding a full REST layer is an architectural rewrite. |
| 314 MCP tools | OIDC/SSO + RBAC | No identity management concept. Adding enterprise auth requires a completely new auth layer. |
| 32-plugin ecosystem | Audit trail with hash chain | No tamper-proof logging. Critical for SOC2/GDPR — can't bolt on after the fact. |
| Self-learning SONA memory | Kubernetes + Helm deployment | Local dev tool, not deployable as infrastructure. Requires architecture change to run as a service. |
| GOAP goal planner | OpenTelemetry tracing | Custom observability plugin, not OTel-standard. Switching requires rearchitecting the plugin. |
| Rust vector engine (HNSW) | Sigstore release signing | No supply-chain security. Not on their roadmap. |
| Federated agent comms | TypeScript + Python SDKs | No client SDKs. Plugin system is the extension point, not programmatic API access. |
| Web UI (flo.ruv.io) | Session lifecycle (terminal states, crash recovery) | No session persistence model. Agents are ephemeral. |
| 12 background workers | Billing/metering API | Cost tracker is local-only. No enterprise billing integration path. |
| Browser automation (Playwright) | SSE event streaming | No real-time streaming for external consumers. |

**Counter-move:** Position Aegis as the production gateway for Ruflo agents. "Use Ruflo to orchestrate, use Aegis to deploy, audit, and govern."

### vs. oh-my-claudecode (33K ⭐)

| They have (our gaps) | We have (their gaps) | Why they can't replicate easily |
|---------------------|---------------------|-------------------------------|
| Plugin marketplace distribution | Web dashboard | OMC is a Claude Code plugin — it runs inside the terminal. A separate web UI requires a standalone service. |
| Autopilot mode | REST API (external consumers) | Plugin architecture has no HTTP surface. Can't be called from CI/CD, webhooks, or other services. |
| Multi-agent team orchestration | MCP server (34 tools) | OMC consumes Claude Code's MCP but doesn't expose one. Becoming an MCP server requires a different architecture. |
| Skill learning system | Enterprise auth (RBAC, OIDC) | Plugin-based — no concept of multi-user, roles, or SSO. Plugin runs in single-user context. |
| Smart model routing (30-50% savings) | Audit trail | No persistent audit log. Plugin sessions are ephemeral. |
| Zero-config install | Kubernetes / Helm | Cannot be deployed as infrastructure. It's a local dev tool. |
| HUD statusline | SSE event streaming | No real-time event streaming for external consumers. |
| Multi-language docs (7 languages) | Session templates + pipelines | No concept of reusable templates or pipeline orchestration. |
| Magic keyword triggers | Session export (JSONL/MD) | No structured transcript export. |
| Deep interview mode | Billing/metering | No usage metering for enterprise billing. |

**Counter-move:** Match their install simplicity (2 commands) while keeping the API/dashboard enterprise depth. They can't follow us into enterprise — plugin architecture won't allow it.

### vs. cc-connect (8K ⭐)

| They have (our gaps) | We have (their gaps) | Why they can't replicate easily |
|---------------------|---------------------|-------------------------------|
| 11 chat platforms (WeChat, QQ, DingTalk, LINE, Feishu, Weibo) | MCP server (34 tools) | Go binary with TOML config. No MCP protocol support. |
| 10+ agent backends | OIDC/SSO + RBAC | Token-only auth. Adding OIDC requires a new auth provider integration. |
| Natural language cron | Audit trail with hash chain | No tamper-proof logging. |
| Voice/STT/TTS support | Kubernetes + Helm | Binary distribution, not container-native. |
| Multi-language (5 languages) | OpenTelemetry tracing | No observability integration. |
| Web admin UI | TypeScript + Python SDKs | Go binary — no JS/Python client libraries. |
| | Session lifecycle management | No terminal states or crash recovery. |
| | Billing/metering API | No usage metering for enterprise. |
| | Sigstore release signing | No supply-chain security. |
| | Session export | No structured export. |

**Counter-move:** cc-connect is converging on our features (lifecycle hooks, auth). But they're Go+TOML, not API-first. We win on programmability and enterprise governance. Stay ahead on compliance features.

### vs. OpenACP (346 ⭐)

| They have (our gaps) | We have (their gaps) | Why they can't replicate easily |
|---------------------|---------------------|-------------------------------|
| 28+ agent backends | Web dashboard (full React) | No web UI. CLI/Telegram-only. |
| Simplest install (curl \| bash) | OIDC/SSO + RBAC | No enterprise identity management. |
| Discord + Slack channels | Audit trail | No persistent audit log. |
| Budget limits per session | Kubernetes / Helm | Not designed as deployable infrastructure. |
| Skill system (brainstorming, TDD, debugging presets) | OpenTelemetry tracing | No observability standard. |
| | TypeScript + Python SDKs | No client SDKs. |
| | Session templates + pipelines | No template or pipeline system. |
| | Memory Bridge | No cross-session state. |
| | Sigstore release signing | No supply-chain security. |

**Counter-move:** OpenACP is the highest-threat small competitor — same architecture, broader agents. But they lack the entire enterprise stack. Our window: ship enterprise features faster than they can add them.

### vs. mission-control (4.7K ⭐)

| They have (our gaps) | We have (their gaps) | Why they can't replicate easily |
|---------------------|---------------------|-------------------------------|
| Multi-gateway support | OIDC/SSO (not just RBAC) | RBAC only. No enterprise SSO integration. |
| Skills Hub | Audit trail with hash chain | No tamper-proof audit logging. |
| Quality gates | Kubernetes + Helm | No K8s deployment story. |
| | OpenTelemetry tracing | Custom monitoring, not OTel. |
| | Billing/metering API | No usage metering. |
| | Sigstore release signing | No supply-chain security. |
| | TypeScript + Python SDKs | No client SDKs. |
| | Session export | No structured export. |

**Counter-move:** mission-control is the most direct competitor (dashboard + RBAC). Our advantage: OIDC, audit trail, K8s, OTel, SDKs. Keep shipping these faster.

### vs. Verdent AI (closed, HIGH threat)

| They have (our gaps) | We have (their gaps) | Why they can't replicate easily |
|---------------------|---------------------|-------------------------------|
| Parallel agent execution | REST API (108 endpoints) | Desktop app architecture has no HTTP surface. Becoming a service requires a complete rewrite. |
| Project memory (persistent context) | OIDC/SSO + RBAC | Single-user desktop app. No concept of multi-user or enterprise identity. |
| Task decomposition (auto-breaks features) | Audit trail with hash chain | No server component. No persistent audit log possible in desktop-first architecture. |
| Mac desktop app (native UX) | Kubernetes + Helm | Cannot be deployed as infrastructure. Desktop app only. |
| Telegram + Slack (message-based tasks) | OpenTelemetry tracing | No observability. No metrics. No tracing. |
| ICSE 2026 Distinguished Paper (academic credibility) | MCP server (34 tools) | No programmatic interface. Other tools can't integrate with Verdent. |
| BYOK + Eco Mode (cost control) | TypeScript + Python SDKs | No SDKs. No API. Closed-source. |
| Italian market focus (localized) | Session lifecycle (terminal states, crash recovery) | No session persistence model. |

**Counter-move:** Verdent wins on UX simplicity and parallel agents. We win on every enterprise dimension. They're Mac-only, closed-source, no API. Different market. Risk: they capture prosumer mindshare before users discover enterprise-grade options. Accelerate #3180 (multi-agent) and #3181 (install friction).

### vs. ccusage-dashboard (1 ⭐, ADJACENT — not a direct competitor)

ccusage-dashboard is an **analytics visualization layer**, not an orchestration tool. They provide 9 interactive cost panels with canonical TTL-split cache pricing. No session management, no agent orchestration, no API.

**Relation:** Complement. Users could run ccusage-dashboard alongside Aegis for deeper cost analytics.

**What to learn:** Their burn rate visualization and canonical cost model are deeper than our `/v1/usage` endpoint. Flag for Phase 4 dashboard work.

## Competitor Detail References

| Issue | Competitor | Key takeaway |
|-------|-----------|-------------|
| #3013 | Ruflo (49K ⭐) | Full-stack, 98 agents, self-learning. Enterprise moat still defensible. |
| #3014 | oh-my-claudecode (33K ⭐) | Zero-config is our biggest UX gap. `/autopilot` mode to replicate. |
| #3004 | cc-connect (8K ⭐) | 11 chat platforms, multi-agent. Converging on our enterprise features. |
| #3003 | OpenACP (346 ⭐) | Same architecture, simpler install, 28+ agents. Highest-threat small competitor. |
| #3016 | Full landscape | 8 competitors ranked. Aegis smallest by stars, deepest by enterprise features. |
| #3234 | ClaudeClaw (1 ⭐) | CC hooks-based simplicity play. Zero infrastructure, conversational onboarding. Tier 1 threat. |
| #3216 | Verdent AI (closed) | Consumer/prosumer parallel agents, project memory, Telegram+Slack. ICSE 2026 Distinguished Paper. Mac-only, closed-source, no API. HIGH adoption threat. |
| #3236 | ccusage-dashboard (1 ⭐) | Adjacent tool, not competitor. 9-panel cost analytics with canonical TTL-split pricing. Complement, not threat. |
| ECC | everything-claude-code (177K ⭐) | Not a competitor — distribution channel. Skills layer, not orchestration. |

---

*Maintained by Scribe 📝 — last deep dive: 2026-05-15 (added Verdent AI, ccusage-dashboard), star counts updated: 2026-05-12. Update on each competitive scan.*

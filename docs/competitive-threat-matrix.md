# Aegis Competitive Threat Matrix

> **Last updated:** 2026-05-11 | **Source:** Issues #3013, #3014, #3016, #3003, #3004 + ECC analysis (Orpheus) + deep competitive research (Scribe)
> **Audience:** Leadership (Ema, Boss) for strategic planning

---

## Executive Summary

The Claude Code orchestration space is **crowded and moving fast**. 8+ competitors with 200×–470× Aegis's star count. The market is bifurcating into **simple developer tools** (win on ease-of-use) and **enterprise platforms** (win on depth and governance). Aegis is an enterprise platform — the moat is real but the **simplicity gap is existential**.

**Bottom line:** We cannot out-feature ruflo (47K ⭐, 98 agents, 314 MCP tools). We cannot out-simplify oh-my-claudecode (33K ⭐, zero-config install). We *can* own the **enterprise orchestration middleware** niche — API-first, compliant, auditable — if we close the install friction gap and ship multi-agent support.

**Strategic window:** 3-6 months. After that, Ruflo's 47K-star community and OMC's 33K-star plugin marketplace distribution will make organic discoverability nearly impossible without paid marketing.

---

## Threat Matrix

| Rank | Competitor | ⭐ | Threat | Installs in | Agent count | Chat platforms | API | Dashboard | Enterprise auth |
|------|-----------|-----|--------|-------------|-------------|---------------|-----|-----------|----------------|
| #1 | **Ruflo** | 47K | 🔴 CRITICAL | `npx ruflo init` | 98 | UI only | ✅ (undocumented) | ✅ (beta) | ❌ |
| #2 | **oh-my-claudecode** | 33K | 🔴 CRITICAL | `/plugin install` (1 cmd) | Multi-agent | Plugin (inside CC) | ❌ | ❌ | ❌ |
| #3 | **cc-connect** | 8K | 🟠 HIGH | Binary download | 10+ | **11** (inc. WeChat, QQ) | ❌ | ✅ (basic) | Token only |
| #4 | **Composio** | 6.9K | 🟠 HIGH | `npm install` | Multi-agent | CI/CD focus | ✅ | ❌ | ❌ |
| #5 | **open-multi-agent** | 6.1K | 🟡 MEDIUM | `npm install` | Multi-agent | MCP only | ✅ | Tracing UI | ❌ |
| #6 | **mission-control** | 4.7K | 🟠 HIGH | `npm install` | Multi-gateway | Skills Hub | ✅ | ✅ | ✅ RBAC |
| #7 | **OpenACP** | 346 | 🟠 HIGH | `curl \| bash` | **28+** | Telegram, Discord, Slack | ✅ | ❌ | ❌ |
| #8 | **ECC** | 177K | 🟢 OPPORTUNITY | Config library | N/A (skills) | N/A | ❌ | ❌ | ❌ |
| — | **Aegis** | ~200 | — | `npm + init + config` | 1 (Claude Code) | 4 | ✅ 34 MCP tools | ✅ Full React | ✅ OIDC/RBAC |

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

---

## New Findings (2026-05-11 Deep Dive)

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

## Competitor Detail References

| Issue | Competitor | Key takeaway |
|-------|-----------|-------------|
| #3013 | Ruflo (47K ⭐) | Full-stack, 98 agents, self-learning. Enterprise moat still defensible. |
| #3014 | oh-my-claudecode (33K ⭐) | Zero-config is our biggest UX gap. `/autopilot` mode to replicate. |
| #3004 | cc-connect (8K ⭐) | 11 chat platforms, multi-agent. Converging on our enterprise features. |
| #3003 | OpenACP (346 ⭐) | Same architecture, simpler install, 28+ agents. Highest-threat small competitor. |
| #3016 | Full landscape | 8 competitors ranked. Aegis smallest by stars, deepest by enterprise features. |
| ECC | everything-claude-code (177K ⭐) | Not a competitor — distribution channel. Skills layer, not orchestration. |

---

*Maintained by Scribe 📝 — last deep dive: 2026-05-11. Update on each competitive scan.*

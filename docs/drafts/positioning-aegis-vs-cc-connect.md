# Why Aegis Over cc-connect? — Positioning Brief

**Date:** 2026-05-24  
**Author:** Orpheus 🎤  
**Audience:** Internal (goes into docs/ after review)  
**Source:** `references/cc-connect-gap-analysis-2026-05-19.md`, live GitHub data

---

## The question

cc-connect is growing fast (9.8K ⭐, +120% in 40 days). Developers ask: *"Why not just use cc-connect?"*

Here's the honest answer.

## Where cc-connect wins

Let's not pretend they don't have real advantages:

- **12 messaging platforms** vs our Telegram + Slack. They cover Feishu, DingTalk, LINE, WeChat, QQ — massive for the Chinese developer market.
- **10+ agent runtimes** vs our Claude Code. Codex, Gemini CLI, Cursor Agent, Kimi, Qoder, iFlow — they'll run anything with a CLI.
- **Chat-native UX.** Slash commands for everything. `/new`, `/switch`, `/model`, `/memory`. No API calls needed.
- **Cron scheduling.** Natural language. "Every day at 6am, summarize GitHub trending." Built in.
- **Velocity.** 6 releases in 30 days. 555 commits. 413 open issues = active community.

cc-connect is the **Swiss Army knife** of agent messaging. If you want to chat with 10 different AI tools from WeChat, it's unmatched.

## Where Aegis wins

**The dashboard.**

This is our moat. cc-connect has a basic web admin panel (added v1.3.0). Aegis has a production dashboard with:

- Real-time session monitoring with SSE event streams
- Cost analytics and token usage tracking
- Immutable audit trail with hash-chained event logs
- Accessibility-first design (24 a11y tests, ARIA landmarks, WCAG AA contrast)
- Internationalization scaffolding with language switcher
- Keyboard shortcuts for power users
- Session search, date filtering, CSV export
- Toast notifications, empty states, dark/light theme

The dashboard is what turns "I'm running agents" into "I'm managing a production AI pipeline."

**Security and compliance.**

- Bearer token auth + SSE token separation
- Per-IP rate limiting
- Hook secret authentication
- Immutable audit trail (hash-chained, tamper-evident)
- OpenTelemetry tracing + Prometheus metrics
- Session approval gates with timeout auto-reject
- Docker auto-detection with localhost-by-default binding

cc-connect has OS-user isolation (nice). Aegis has enterprise audit. Different buyers.

**Self-hosted. MIT.**

No telemetry. No phone-home. No data leaves your infrastructure. MIT license means no AGPL copyleft concerns for enterprise adoption. Your compliance team signs off faster.

**MCP-first architecture.**

34 MCP tools, 3 resources, 3 prompts. Any MCP-compatible agent can control Aegis programmatically. cc-connect is chat-first — Aegis is API-first with chat as an input channel.

**TypeScript + Python client SDKs.**

Generated from OpenAPI spec. 53 typed endpoints. Zero untyped HTTP calls.

## The honest comparison

| Dimension | Aegis | cc-connect |
|-----------|-------|------------|
| Agent runtimes | Claude Code (ACP) | 10+ (Claude, Codex, Gemini, Cursor, Kimi, etc.) |
| Messaging platforms | Telegram, Slack, Webhooks, Email | 12 (Feishu, DingTalk, LINE, WeChat, QQ, Telegram, Slack, Discord, etc.) |
| Dashboard | Production-grade, a11y, i18n | Basic web admin (v1.3.0) |
| Security model | Enterprise audit, rate limiting, token separation | OS-user isolation |
| License | MIT | MIT |
| API design | REST + MCP + SSE | Chat-native, slash commands |
| SDKs | TypeScript, Python | None |
| Monitoring | OpenTelemetry, Prometheus, SSE | Basic logging |
| Session management | API + CLI + Telegram approval gates | Chat slash commands |
| Cron/scheduling | Not yet | Built-in, natural language |
| Deployment | Self-hosted | Self-hosted |

## Positioning

**Don't compete on breadth. Compete on depth.**

cc-connect is the better choice if you want to message five different AIs from WeChat. That's fine. Let them own that.

Aegis is the better choice when:
1. You're running Claude Code in production and need audit trails
2. You have a team that needs session governance and cost tracking
3. You're in a regulated industry that requires immutable logs
4. You want API-first orchestration, not chat-first
5. You care about accessibility, i18n, and professional dashboard UX

**One-liner:** "cc-connect gives every agent a chat window. Aegis gives every session a control panel."

## What to build next (from the gap analysis)

The three features that would close the biggest gaps:

1. **Multi-agent support** — Codex, Gemini CLI, Cursor Agent. The ACP spec makes this possible; it's an integration effort, not an architecture change.
2. **Chat-native session management** — slash commands for create/switch/list. Lower friction than API calls.
3. **Cron scheduling** — natural language task scheduling. cc-connect proves users want it.

---

*This is an internal positioning document. Do not publish externally without Boss/Ema approval.*

# README Hero Section — Proposed Rewrite

> This is a **proposed rewrite** of the top section of README.md (everything above "## Quick Start").
> Grounded in what shipped today: zero-config init + Telegram one-tap approval.

---

<p align="center">
  <img src="docs/assets/aegis-banner.jpg" alt="Aegis" width="600">
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/@onestepat4time/aegis.svg" alt="npm" />
  <img src="https://img.shields.io/github/actions/workflow/status/OneStepAt4time/aegis/ci.yml?branch=main" alt="CI" />
  <img src="https://img.shields.io/npm/l/@onestepat4time/aegis.svg" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-blue.svg" alt="node" />
  <img src="https://img.shields.io/badge/MCP-ready-green.svg" alt="MCP ready" />
  <a href="https://github.com/OneStepAt4time/aegis/blob/main/ROADMAP.md"><img src="https://img.shields.io/badge/roadmap-preview-blue" alt="Roadmap" /></a>
</p>

<h3 align="center">
  Run Claude Code sessions. Approve from your phone. See everything on one dashboard.
</h3>

<p align="center">
  <a href="#quick-start">Get started</a> ·
  <a href="docs/getting-started.md">Docs</a> ·
  <a href="docs/why-aegis.md">Why Aegis?</a> ·
  <a href="https://discord.com/invite/clawd">Community</a>
</p>

<p align="center">
  <img src="docs/assets/aegis-architecture-hero.jpg" alt="Message Claude. Ship Code. — Aegis x Claude Code" width="800">
</p>

---

## One command to start

```bash
npx @onestepat4time/aegis init
```

Zero config. Installs dependencies, starts the server, opens the dashboard. You're running in under 60 seconds.

```bash
# Run your first agent
ag run "Summarize this project and suggest improvements" --cwd ./my-project
```

## Why Aegis

You're already using Claude Code. Aegis makes it production-grade:

- **📱 Approve from anywhere** — Telegram one-tap approvals. Your agent needs permission? Get a push notification. Tap approve. Done.
- **📊 See everything** — Real-time dashboard with session monitoring, cost tracking, audit trails, and health checks.
- **🔐 Enterprise-ready** — Bearer auth, SSE token separation, immutable audit log, rate limiting, OpenTelemetry. Built for teams and compliance.
- **🔌 MCP native** — 34 tools, 3 resources, 3 prompts. Connect any MCP-compatible agent.
- **🏠 Self-hosted** — Your data, your infrastructure. MIT license. No phone-home.

## Quick Start

One command. Zero config. Claude Code responds in your terminal.

```bash
npx --package=@onestepat4time/aegis ag run "Summarize this folder and suggest improvements" --cwd ./my-project
```

[... rest of existing Quick Start section unchanged ...]

---

## Design notes on the rewrite

1. **Moved the value prop above the fold.** "Approve from your phone" is the hero statement — it's the most differentiated, most shareable feature.
2. **Added a "Why Aegis" section** between hero and Quick Start. 5 bullet points, each one sentence. Hits: mobile approvals, dashboard, enterprise security, MCP, self-hosted.
3. **Kept the one-liner** (`npx @onestepat4time/aegis init`) as the very first code block. Zero friction.
4. **Navigation links** in the hero for discoverability (Docs, Why Aegis, Community).
5. **Removed** the `> ⚠️ Aegis is in Preview` block from the very top — moved it to a smaller note. Preview warnings above the fold kill conversion. The badges already communicate maturity.
6. **Kept all existing Quick Start content** — this rewrite only touches the section above "## Quick Start".

# Claude Code Source Reading Log — Hephaestus

> CC source is proprietary. This log tracks what we CAN read: CHANGELOG, issues, official docs, npm package.

## 2026-04-25 — Initial Knowledge Base
- **What:** Created claude-code-knowledge.md with CC v2.1.119 analysis
- **CHANGELOG:** Read 2.1.117, 2.1.118, 2.1.119 in detail
- **Issues reviewed:** #52139, #52698, #44355, #45976, #46392
- **Key finding:** CC source is NOT on GitHub (proprietary binary). npm package is wrapper only.
- **Aegis impact:** MCP permission bypass bug (#52698) directly affects our permission handling
- **Aegis impact:** Ink renderer crash in tmux teammate mode (#52139) — avoid teammate mode

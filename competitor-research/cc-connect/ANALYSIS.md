# cc-connect — Competitor Analysis
**Date:** 2026-04-07
**Stars:** 4,457
**Language:** Go

## What It Does
Bridges local AI coding agents (Claude Code, Cursor, Gemini CLI, Codex) to messaging platforms.

## Key Features
| Feature | cc-connect | Aegis |
|---------|-----------|-------|
| Discord/Telegram | ✅ Native | ✅ MCP |
| HTTP bridge | ❌ | ✅ Fastify |
| MCP server | ❌ | ✅ |
| Git worktrees | ❌ | ✅ |
| Multi-agent | ✅ | Partial |

## Gaps for Aegis
1. Auto-compress context per sessioni lunghe
2. Cron with boundaries (per-job timeout)
3. WeChat/Feishu integration
4. Platform feature matrix approach

## Source
`/tmp/cc-connect-src/`

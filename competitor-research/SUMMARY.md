# Aegis — Competitor Analysis Summary

**Date:** 2026-04-07  
**Objective:** Enterprise-grade beta by Saturday

## Competitors Analyzed

| Tool | Stars | Language | Key Differentiator |
|------|-------|----------|---------------------|
| cc-connect | 4,457 | Go | Messaging bridge (Discord, Telegram, WeChat) |
| agent-of-empires | 1,457 | Rust | Multi-agent + TUI dashboard + Docker |

## Aegis Position

**Strengths:**
- HTTP REST API + MCP server (unique)
- npm package — easy install
- TypeScript — easy to extend
- Web dashboard
- Git worktree isolation

**Weaknesses:**
- Single agent (Claude Code only)
- No TUI
- No Docker sandboxing
- No multi-agent orchestration
- No diff view in-app

## Top 5 Gaps to Fill for Enterprise Grade

1. **TUI dashboard** — agent-of-empires ha TUI completa. Aegis dovrebbe avere CLI/TUI complementare al web dashboard
2. **Multi-agent support** — Codex, Gemini CLI, Aider come backend alternativi
3. **Docker sandboxing** — isolation per test pericolosi
4. **Context compression** — auto-trim sessioni lunghe (cc-connect beta feature)
5. **Diff/grep view integrato** — review file senza lasciare il tool

## Next Steps

- [ ] Issue: TUI dashboard
- [ ] Issue: Multi-agent (Codex + Gemini support)
- [ ] Issue: Docker sandboxing
- [ ] Issue: Context compression
- [ ] Issue: Integrated diff view

## Source Repos

- `competitors/cc-connect-src/` — cc-connect (Go)
- `competitors/agent-of-empires-src/` — Agent of Empires (Rust)

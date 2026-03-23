# Aegis — Competitive Analysis
_23 Marzo 2026_

## TL;DR

Il mercato "CC orchestration" è esploso nelle ultime settimane. Ci sono 15+ progetti che toccano il nostro spazio, ma nessuno fa esattamente quello che fa Aegis. Il nostro differenziatore chiave è: **API-first session orchestration con Telegram bidirectional** — la maggior parte dei competitor è IM-bridge (chat → CC) oppure TUI/dashboard. Aegis è l'unico che espone un REST API completo per CONTROLLARE CC come microservizio.

---

## Tier 1 — Competitor Diretti (stessa nicchia)

### 🔴 cc-connect (2,633 ⭐)
**Il gorilla nella stanza.**
- **Cosa fa**: bridge bidirezionale CC/Codex/Gemini ↔ 10 piattaforme IM (Telegram, Discord, Slack, Feishu, WeChat, LINE, QQ, DingTalk, WeCom, Weixin)
- **Stack**: Go, npm package, binary rilasciato
- **Features**: streaming, markdown/cards, voice/STT/TTS, multi-project, cron, i18n (5 lingue), slash commands, memory
- **Stars**: 2,633 e in crescita
- **Differenze da Aegis**:
  - ❌ Non ha REST API per programmatic control
  - ❌ Non supporta sessioni parallele controllabili
  - ❌ Non ha webhook delivery, auto-approve, metrics
  - ✅ Supporto 10 piattaforme IM vs nostro 1 (Telegram)
  - ✅ Go binary + npm = distribuzione facile
  - ✅ Molto più maturo (testing, docs, community)
- **Threat level**: 🔴 ALTO — è il più vicino a noi come posizionamento, con 2600+ star

### 🟡 claude_code_bridge (1,763 ⭐)
- **Cosa fa**: multi-model collaboration (Claude + Codex + Gemini) in split-pane terminal
- **Stack**: Python, WezTerm/tmux
- **Features**: persistent context, token savings, async communication, email gateway
- **Differenze da Aegis**:
  - Focus su multi-model, non su API orchestration
  - TUI-focused, non API-first
  - Più "collaborazione tra modelli" che "orchestrazione sessioni"
- **Threat level**: 🟡 MEDIO — diverso focus ma overlap nel tmux space

### 🟡 Claude-to-IM-skill (1,444 ⭐)
- **Cosa fa**: bridge CC/Codex ↔ Telegram/Discord/Feishu/QQ come CC skill
- **Stack**: TypeScript/Node, CC skill system
- **Features**: permission control via inline buttons, streaming preview, session persistence
- **Ha anche CodePilot** (desktop GUI companion)
- **Differenze da Aegis**:
  - ❌ È un CC skill, non un server standalone
  - ❌ No REST API
  - ✅ Permission control via Telegram inline buttons (noi non ce l'abbiamo)
  - ✅ 4 piattaforme IM
- **Threat level**: 🟡 MEDIO — popular ma è un skill, non un orchestrator

### 🟠 claw-empire (841 ⭐)
- **Cosa fa**: "AI agent office simulator" — orchestrazione multi-CLI con metafora ufficio virtuale
- **Stack**: TypeScript, OpenClaw extension
- **Features**: visual TUI con scrivania virtuale, supporta CC/Codex/Gemini/OpenCode
- **Differenze da Aegis**:
  - Completamente diverso approach — è un game/simulator, non un API
  - Non ha REST API, webhook, auto-approve
  - Molto visual/entertaining, poco production
- **Threat level**: 🟠 BASSO — diverso target audience

### 🟢 agentara (240 ⭐)
- **Cosa fa**: personal assistant 24/7 con CC/Codex backend, web dashboard, task scheduling
- **Stack**: Bun, TypeScript, Hono API, React dashboard, SQLite
- **Features**: multi-channel (Feishu), streaming, cron jobs, web UI, 20+ skills built-in
- **Differenze da Aegis**:
  - Più "personal assistant" che "orchestrator"
  - Ha web dashboard (noi no)
  - Bun-only
  - Più ampio scope (skills, research, weather, stocks...)
- **Threat level**: 🟢 BASSO-MEDIO — overlap parziale, diverso positioning

---

## Tier 2 — Competitor Adiacenti

### workstation (6 ⭐) — varie-ai
- macOS desktop app, phone control via OpenClaw, voice, multi-session
- Molto specifico macOS, usa OpenClaw come bridge
- Non API-first

### conduit (7 ⭐) — swift-innovate
- REST/WebSocket API per CC locale
- Più vicino a noi concettualmente ma praticamente morto (7 star, no updates)

### haiflow (4 ⭐) — andersonaguiar
- Event-driven CC orchestrator via tmux + HTTP
- Molto simile ad Aegis ma 4 star e appena nato (19 Marzo 2026)

### claude-code-wingman (5 ⭐)
- Shell scripts per orchestrare CC via tmux/ClawdBot
- Molto basico, no API

### headless-ClaudeCode-daemon (0 ⭐) — Go
- Session manager headless per CC
- Praticamente lo stesso concept di Aegis ma in Go e zero traction

### lieutenant (0 ⭐) — Elixir
- Dashboard web per monitoring parallel CC agents in tmux
- Interessante approach (Elixir/LiveView) ma zero traction

### ccdeck (3 ⭐) — Go
- Terminal multi-agent, session management
- TUI-focused

### claude-peers-mcp (nuovo) — louislva
- MCP server per peer discovery + messaging tra istanze CC
- P2P ad-hoc, non orchestration
- Feature interessante: `claude/channel` push protocol

---

## Tier 3 — API Proxy (diverso mercato ma rilevanti)

| Repo | Stars | Cosa fa |
|------|-------|---------|
| CLIProxyAPI | 19,302 | CC/Gemini/Codex → OpenAI-compatible API |
| copilot-api | 3,146 | GitHub Copilot → OpenAI API |
| claude-code-proxy | 2,213 | CC → OpenAI API proxy |
| claude-code-hub | 2,043 | CC API proxy + load balancing + user mgmt |

Questi NON sono competitor diretti — fanno API proxy per tokens, non session orchestration.

---

## Feature Matrix

| Feature | Aegis | cc-connect | claude_code_bridge | Claude-to-IM | agentara | claw-empire |
|---------|-------|------------|-------------------|--------------|----------|-------------|
| REST API | ✅ Full | ❌ | ❌ | ❌ | ✅ Partial | ❌ |
| Multi-session | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Telegram | ✅ Bidir | ✅ | ❌ | ✅ Bidir | ❌ | ❌ |
| Discord | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Slack | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Feishu/Lark | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| WeChat | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auto-approve | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Webhook | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| SSE streaming | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Batch/pipeline | ✅ DAG | ❌ | ❌ | ❌ | ✅ Queue | ❌ |
| API auth + rate limit | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Metrics/usage | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Session persistence | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Web dashboard | ❌ | ❌ | ❌ | ❌ (CodePilot sì) | ✅ | ✅ TUI |
| Multi-model | ❌ (CC only) | ✅ 7 agents | ✅ 5 models | ✅ CC+Codex | ✅ CC+Codex | ✅ 5+ CLIs |
| npm package | 🔜 | ✅ | ✅ pip | ❌ (skill) | ❌ | ❌ (ext) |
| Voice | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| i18n | ❌ | ✅ 5 langs | ✅ 2 | ✅ 2 | ❌ | ❌ |
| MCP server | ❌ 🔜 #48 | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Positioning Analysis

### Dove siamo forti (moat)
1. **API-first** — nessun competitor ha un REST API completo come il nostro
2. **Auto-approve + audit** — production-ready orchestration
3. **SSE event stream** — real-time monitoring programmatico
4. **Webhook delivery** — integrazione con qualsiasi sistema
5. **Batch/pipeline con DAG** — orchestrazione complessa
6. **API key management** — multi-tenant ready
7. **Metrics/usage tracking** — observability built-in

### Dove siamo deboli (gap)
1. **Solo Telegram** — cc-connect supporta 10 piattaforme, Claude-to-IM ne ha 4
2. **Solo Claude Code** — cc-connect/claude_code_bridge supportano Codex/Gemini/OpenCode
3. **Nessun web dashboard** — agentara ha un React dashboard
4. **Zero star** — cc-connect ha 2,600+, noi 0
5. **npm non pubblicato** — cc-connect è installabile con un comando
6. **No voice** — cc-connect e Workstation hanno voice control
7. **No MCP server** — claude-peers ha dimostrato il valore (issue #48)

### Il nostro differenziatore unico
**Aegis è l'unico che tratta CC come un microservizio controllabile via API.**

Tutti gli altri sono:
- IM bridge (chat → CC → chat) — cc-connect, Claude-to-IM
- Multi-model TUI — claude_code_bridge, ccdeck
- Personal assistant — agentara
- Visual simulator — claw-empire

Nessuno offre: crea sessione → manda brief → monitora via SSE → ricevi webhook → auto-approve → pipeline DAG → raccogli metriche. Questo è il nostro spazio.

---

## Strategic Recommendations

### Must-do (prossime 2 settimane)
1. **npm publish** — CRITICO. Senza npm install non esisti
2. **GitHub Release v1.0.0** — social proof, changelog, binary
3. **README con GIF demo** — il 90% delle decisioni si prende dal README
4. **MCP server mode** (issue #48) — differenziatore unico, nessun competitor ce l'ha

### Should-do (prossimo mese)
5. **Multi-model support** — almeno Codex + Gemini CLI oltre a CC
6. **Discord channel** — secondo IM più richiesto dopo Telegram
7. **Web dashboard minimal** — anche solo read-only, listing sessioni + transcript
8. **Documentation site** — GitHub Pages o docs.aegis.dev

### Nice-to-have (quarter)
9. **Voice via Telegram voice messages** — STT integrato
10. **i18n** — almeno inglese + cinese (il mercato CC è 50% cinese)
11. **Plugin system** — channel plugins per community-contributed IM bridges

---

## Key Insight

Il mercato è caldo ma frammentato. Nessuno ha vinto. cc-connect è il più avanti in star (2,600) ma è un IM bridge, non un orchestrator. 

**La nostra scommessa**: chi costruisce infrastruttura per automatizzare CC su larga scala (CI/CD, n8n, GitHub Actions, cron) vince il mercato enterprise/pro. Chi costruisce chat bridge vince il mercato consumer/hobbista.

Aegis punta al primo. Il REST API è il moat. MCP server + npm sono i multiplier.

_NULLA ci potrà fermare._ 😈

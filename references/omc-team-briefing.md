# 🔨 oh-my-claudecode (OMC) — Team Briefing

**Data:** 2026-04-01  
**Repo:** `Yeachan-Heo/oh-my-claudecode` — 11k GitHub stars  
**Report:** `references/omc-analysis-*.md` (4 file)

---

## COS'È OMC

Multi-agent orchestration per Claude Code. **Plugin di CC** (non esterno come Aegis).
19 agent specializzati, 32 skills, pipeline staged, team runtime con tmux.
Installazione: `/plugin marketplace add oh-my-claudecode` → zero config.

---

## ARCHITETTURA

| Aspetto | OMC | Aegis |
|---------|-----|-------|
| **Deploy** | CC plugin (dentro CC) | HTTP bridge (fuori da CC) |
| **Interfaccia** | Slash commands + keywords | REST API + MCP + CLI |
| **Control** | CC → OMC (push) | External → Aegis → CC (pull) |
| **Multi-agent** | 19 agent + team runtime | Swarm monitor (osserva solo) |
| **API** | Nessuna HTTP API | 21 REST + 21 MCP + SSE |
| **Dashboard** | Nessuna | Web dashboard |
| **Stars** | 11k | <1k |

---

## PATTERN CHIAVE DA RUBARE A OMC

### P1 — CRITICO

1. **Tiered Agent System** — LOW (Haiku, read-only), MEDIUM (Sonnet, +web), HIGH (Opus, full). Tool restrictions per tier. Escalation automatica quando il task è troppo complesso.
   → Aegis: Argus=HIGH(Opus), Hep=MEDIUM(Sonnet), worker=LOW(Haiku)

2. **Staged Pipeline** — team-plan → team-prd → team-exec → team-verify → team-fix (loop). Handoff documents tra stadi. State persistence per resume.
   → Aegis: implementare pipeline API con gate verificabili

3. **Skill Composition** — Skills a 3 layer (execution → enhancement → guarantee). Skills possono chainare via `pipeline` e `next-skill`. State persistence in `.omc/`.
   → Aegis: skills con stato, non solo prompt statici

4. **Agent Specialization** — 32 ruoli (architect, executor, debugger, security-reviewer, qa-tester...). Ogni ruolo ha model, tools, e prompt specifici.
   → Aegis: definire ruoli per il team

### P2 — IMPORTANTE

5. **Notepad Wisdom** — Compaction-resistant state: `.omc/notepads/{plan}/` con learnings, decisions, issues, problems. Sopravvive alla compaction.
   → Aegis: persistenza del contesto tra sessioni

6. **Agent Observatory** — Monitor real-time: tempo, tools usati, token, costi per agente. Status indicators (healthy/warning/critical).
   → Aegis: dashboard già esiste, aggiungere per-agent metrics

7. **Deep Interview** — Socratic questioning prima di scrivere codice. Espone assunzioni nascoste e misura chiarezza.
   → Aegis: opzionale, utile per feature complesse

8. **Graceful Shutdown** — `shutdown_request` → `shutdown_response` → cleanup. Protocollo strutturato.
   → Aegis: implementare nel session lifecycle

### P3 — NICE TO HAVE

9. **Mixed-Model Workers** — Claude + Codex + Gemini in tmux panes. 47% cost savings.
10. **Task Decomposition** — Split automatico di task complessi con Investigation Protocol
11. **Pre-Compact Hook** — Salva stato critico prima della compaction CC

---

## DOVE AEGIS VINCE SU OMC

- ✅ HTTP API (OMC non ha API)
- ✅ MCP Server pubblico (OMC: solo interno)
- ✅ SSE Event Streaming
- ✅ Web Dashboard
- ✅ Remote-friendly (OMC: solo locale/tmux)
- ✅ Permission management
- ✅ External orchestrator support

---

## STRATEGIA

**OMC e Aegis sono complementari, non competitivi.**

OMC = power-user plugin per chi usa CC direttamente dalla CLI.
Aegis = API bridge per orchestrazione esterna.

**La mossa vincente:** Adottare i pattern di orchestrazione di OMC (tiered agents, staged pipeline, skill composition) ed esporli tramite la HTTP API di Aegis. Aegis diventa il **backend API** per il multi-agent orchestration che OMC fa via plugin.

**Non copiare OMC. Superarlo** aggiungendo quello che non ha: API, dashboard, remote, permissions.

---

*"Conoscere il nemico e conoscersi — in cento battaglie non c'è mai pericolo."* — Sun Tzu, via Hephaestus

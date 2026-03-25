# Report: Stato dell'Arte — Gap e Roadmap Aegis vs Claude Code

**Data:** 2026-03-24 | **Fonti:** aegis-cc-cross-analysis.md + claude-code-tmux-analysis.md + .claude-internals/ | **CC analizzato:** v2.1.81

---

## 1. Gap Architetturali tra Aegis e Claude Code

### tmux Operations
| Aspetto | Claude Code | Aegis | Gap |
|---------|------------|-------|-----|
| Mutex operazioni | ✅ Promise-chain globale | ❌ Nessun mutex | **Race conditions** (B1) |
| Timeout comandi | ✅ Timeout calcolato | ❌ Nessun timeout | **Hang server** |
| Socket isolation | ✅ `-L claude-swarm-{pid}` | ❌ Sessione singola "aegis" | Collisioni multi-istanza |
| Debounce post-op | ✅ 200ms | ❌ Fixed delays 1-2s | Sufficiente ma non ottimale |
| Retry tmux | ❌ 0 tentativi (fail-fast) | ✅ 3 tentativi | **Aegis più robusto** |
| sendKeys con verifica | ❌ Fire-and-forget | ✅ sendKeysVerified (3 retry) | **Aegis più robusto** |

### Terminal Parser
| Aspetto | CC | Aegis | Gap |
|---------|-----|-------|-----|
| Spinner braille | ✅ Riconosciuti | ❌ Non riconosciuti | working → unknown/idle (B4) |
| Stato `error` | ✅ Messaggi dedicati | ❌ Non esiste | Errori API invisibili (B5) |
| Position awareness | ✅ UI Ink posizionata | ❌ Match su tutto scrollback | False positive (B7) |
| MCP permessi | ✅ Rilevati | ❌ Non rilevati | Stall silenzioso (B3) |
| Workspace trust | ✅ Prompt dedicato | ❌ Non rilevato | Stall silenzioso |

### Hook System
| Hook | Campi CC | Campi Aegis | Gap |
|------|----------|------------|-----|
| SessionStart | 8 campi | 2 (session_id, cwd) | **6 campi persi** |
| StopFailure | 6 campi | 2 (error, stop_reason) | **4 campi persi** (B6) |
| SubagentStart/Stop | ✅ | ❌ | Non gestiti |
| PermissionRequest | ✅ Pre-prompt | ❌ | 2s polling latency |
| TaskCompleted | ✅ | ❌ | Completion inferito da idle |
| PreCompact/PostCompact | ✅ | ❌ | Compaction invisibile |

### Permission Modes
| Modalità CC | Aegis | Gap |
|-------------|-------|-----|
| `default` | ✅ | — |
| `bypassPermissions` | ✅ | — |
| `acceptEdits` | ❌ | Bash non promptato ma edit auto (B9) |
| `plan` | ❌ | Solo pianificazione |
| `dontAsk` | ❌ | Nega se non pre-approvato |

---

## 2. Bug e Risk Conosciuti

### Già Fixati ✅
- **P0 Prompt delivery** — timeout 60s + 2 retry exponential backoff (PR #61)
- **P1 Dead session detection** — monitor rileva finestre tmux morte (PR #62)
- **P1 Permission guard** — neutralizza bypassPermissions (PR #60)

### Ancora Aperti

| ID | Bug/Risk | Impatto | Prob. |
|----|----------|---------|-------|
| **B1** | Race condition tmux (no mutex) | Alto | Media |
| **B2** | `$TMUX` non unset → CC split-pane nel pane Aegis | Alto | Alta |
| **B3** | Regex permessi incomplete (MCP, workspace trust, batch) | Alto | Alta |
| **B4** | Braille spinners non riconosciuti | Medio | Alta |
| **B5** | Nessuno stato `error` nel parser | Medio | Alta |
| **B6** | StopFailure perde 4 campi | Medio | Certa |
| **B7** | Settings patterns senza anchor `^\s*` | Medio | Media |
| **B8** | Dead detection solo finestra, non processo | Medio | Media |
| **B9** | Rate-limit CC invisibile | Medio | Media |
| **B10** | Approve "y" non gestisce menu numerati | Medio | Media |
| **B11** | autoApprove: boolean vs enum 5 mode | Medio | Certa |

---

## 3. Scoperte dagli Internals CC

### Cose utili per Aegis

1. **StatusLine JSON** — CC invia JSON via stdin: `session_id`, `model`, `context_window` (used/remaining %), `rate_limits` (5h/7d)
2. **Buffered output 1s** — CC ha buffered writer con 1000ms flush. Output tmux ha fino a 1s delay.
3. **Bash `run_in_background` + `backgroundTaskId`** — comandi background tracciabili
4. **Compressione output intelligente** — git, npm test, docker, vitest, etc.
5. **5 moduli nativi Bun** proprietari (image-processor, color-diff, tree-sitter-bash, audio-capture, file-index)
6. **`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`** — zero telemetria per sessioni Aegis
7. **`cleanupPeriodDays: 30`** — auto-pulizia JSONL. 0 per disabilitare.
8. **Feature flags server-side** (GrowthBook) — non forzabili
9. **Plugin/marketplace system** completo
10. **`--output-format json`** potrebbe esistere per output strutturato

---

## 4. Piano d'Azione

### Sprint 1 — P0 Bloccanti (giorni 1-3, ~4 ore)

```
Task 1: [B1+H1+H5] Timeout tmux 10s + unset $TMUX + StopFailure fields
Task 2: [B4+B5] Braille spinners + stato error nel parser
Task 3: [B3+B7] Regex permessi MCP/workspace trust/batch + anchor settings
```

### Sprint 2 — P1 Affidabilità (giorni 4-7, ~8 ore)

```
Task 4: [B1] Mutex operazioni tmux
Task 5: [B8+B9] Dead detection processo + rate-limit detection
Task 6: [B11+B10] Permission mode enum + approve intelligente
```

### Sprint 3 — P2 DX e Osservabilità (giorni 8-14, ~11 ore)

```
Task 7: Hook fields completi (SessionStart + StopFailure)
Task 8: Metriche latenza + persist per-session
Task 9: Circuit breaker + SSE events
Task 10: Subagent hooks + dead detection indipendente
```

### Sprint 4 — P3 Ottimizzazione (post-v1.1, ~20 ore)

```
Task 11: Socket isolation + fs.watch()
Task 12: Swarm awareness + PermissionRequest/TaskCompleted hooks
Task 13: Test coverage completo (19 scenari mancanti)
```

---

## 5. Riepilogo Numerico

| Stato | Conteggio |
|-------|-----------|
| Già fixati | 3 PR (#60, #61, #62) |
| P0 rimanenti | 6 task (~4 ore) |
| P1 | 6 task (~8 ore) |
| P2 | 8 task (~11 ore) |
| P3 | 13+ task (~20 ore) |
| Bug aperti | 11 |
| Hook gap | 6 campi SessionStart + 4 StopFailure |
| Permission gap | 3 mode non supportate |
| Test mancanti | 19 scenari |

**P0+P1 = ~12 ore → Aegis production-ready per uso singolo-session.**

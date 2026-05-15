# Pre-Release Test Results — v1.4.0 (prima di tag)

**Data:** 2026-03-28 04:15 CET
**Aegis version:** 1.3.3 (production)
**CC version:** 2.1.86
**Tester:** Hephaestus (automated)

## Risultati

| # | Test | Risultato | Note |
|---|------|-----------|------|
| 1 | Crea sessione via API | ✅ PASS | POST /v1/sessions, sessione creata e visibile in lista |
| 2 | Prompt delivery + capture-pane | ✅ PASS | promptDelivery: {delivered: true, attempts: 1}, CC risposto TEST_OK_DELIVERY |
| 3 | Auto-approve permissions | ✅ PASS | bypassPermissions mode, Write tool approvato automaticamente |
| 4 | Kill session + cleanup | ✅ PASS | DELETE rimuove sessione + tmux window, nessun zombie |
| 5 | Sessioni parallele (N=3) | ✅ PASS | 3 sessioni create contemporaneamente, tutte risposto PARALLEL_1/2/3 |
| 6 | CC crash detection | ⚠️ PARTIAL | CC killato, tmux mostra "Killed". Ma stall threshold 5min troppo lungo per detect rapido |
| 7 | WebSocket terminal | ✅ PASS | WS connected, riceve pane content + status events |
| 8 | Batch session creation | ✅ PASS | 3 sessioni in una chiamata, created=3 failed=0 |
| 9 | SSE stream | ⚠️ PARTIAL | Endpoint connette (200, connected event). Ma 0 output events per sessioni working |
| 10 | Dashboard + metrics | ✅ PASS | HTML+JS+CSS 200, metrics: 225/225 prompt delivery (100%), session-level duration |

**Totale:** 8/10 PASS, 2/10 PARTIAL

## Findings (da aprire come issue)

### Finding 1 — Crash detection troppo lenta (Test 6)
- **Problema:** Stall threshold 300s (5 min). CC crashato ma Aegis non lo rileva per 5 min.
- **Suggerimento:** Aggiungere pane-exit detection (tmux `pane-exited` hook) per crash immediato
- **Priorità:** P1

### Finding 2 — SSE non streama output per sessioni working (Test 9)
- **Problema:** /v1/sessions/:id/events si connette ma non riceve pane-content events
- **Suggerimento:** Verificare che il monitor pubblichi eventi nell'eventBus per ogni pane update
- **Priorità:** P1

# Aegis × Claude Code — Analisi Incrociata e Roadmap

**Data:** 2026-03-24
**Metodo:** Swarm di 5 agenti paralleli — analisi incrociata codebase Aegis vs CC v2.1.81
**Fonti:** Codice sorgente Aegis + `/tmp/claude-extracted/` + `docs/claude-code-tmux-analysis.md`

---

## Indice

1. [Executive Summary](#1-executive-summary)
2. [HIGH — Bug Critici e Fix Obbligatori](#2-high--bug-critici-e-fix-obbligatori)
3. [MEDIUM — Gap Funzionali e Miglioramenti](#3-medium--gap-funzionali-e-miglioramenti)
4. [LOW — Nice-to-Have e Technical Debt](#4-low--nice-to-have-e-technical-debt)
5. [Nuove Feature Idee da CC](#5-nuove-feature-idee-da-cc)
6. [Matrice Completa dei Findings](#6-matrice-completa-dei-findings)

---

## 1. Executive Summary

Lo swarm ha analizzato 5 aree del codebase Aegis incrociandole con il reverse-engineering di Claude Code v2.1.81:

| Area | Agent | HIGH | MEDIUM | LOW |
|------|-------|------|--------|-----|
| tmux.ts vs CC TmuxBackend | #1 | 2 | 4 | 4 |
| Terminal Parser vs CC UI | #2 | 3 | 5 | 9 |
| Session Lifecycle vs CC Hooks | #3 | 1 | 5 | 4 |
| Permessi e Config vs CC | #4 | 1 | 5 | 4 |
| Monitor/Channels vs CC | #5 | 3 | 8 | 15 |

**Totale: 10 HIGH, 27 MEDIUM, 36 LOW**

### Top 5 azioni prioritarie

| # | Azione | Impatto | Sforzo |
|---|--------|---------|--------|
| 1 | Aggiungere timeout ai comandi tmux | HIGH | Basso |
| 2 | Aggiungere braille spinner chars al parser | HIGH | Basso |
| 3 | Aggiungere mutex per operazioni tmux | HIGH | Medio |
| 4 | Ampliare regex permessi (MCP, workspace trust, batch) | HIGH | Basso |
| 5 | Unset `$TMUX` prima di lanciare CC | HIGH | Basso |

---

## 2. HIGH — Bug Critici e Fix Obbligatori

### H1. Timeout mancanti sui comandi tmux

**File:** `src/tmux.ts:28-31`
**Impatto:** Un singolo comando tmux bloccato può hangare l'intero server Aegis (monitor, API, tutto).

```typescript
// ATTUALE — nessun timeout
private async tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', args);
  return stdout.trim();
}

// FIX — aggiungere timeout di 10s
private async tmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', args, { timeout: 10_000 });
  return stdout.trim();
}
```

CC ha timeout calcolati su tutti i comandi tmux. Aegis no — se `capturePane` o `sendKeys` hangano, il processo Node resta bloccato indefinitamente.

---

### H2. Braille spinner characters mancanti

**File:** `src/terminal-parser.ts` — set `STATUS_SPINNERS`
**Impatto:** CC usa spinner braille (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) comuni in tmux con `TERM=xterm-256color`. Aegis non li riconosce → stato `working` rilevato come `unknown`/`idle`.

```typescript
// ATTUALE
const STATUS_SPINNERS = ['.', '✻', '✽', '✶', '✳', '✢'];

// FIX — aggiungere braille spinners
const STATUS_SPINNERS = [
  '.', '✻', '✽', '✶', '✳', '✢',
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
  '⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷',
];
```

---

### H3. Mutex/serializzazione mancante per operazioni tmux

**File:** `src/tmux.ts` (intera classe)
**Impatto:** Race conditions possibili in 3 scenari:

1. **Creazione sessioni concorrenti**: Due `POST /v1/sessions` simultanei possono creare finestre con lo stesso nome (il check `existingNames.has(finalName)` non e' atomico)
2. **Monitor vs API**: Il monitor chiama `capturePane` ogni 2s; l'API chiama `sendKeysVerified` (che chiama `capturePane`). Interleaving sulla stessa finestra produce state inconsistente
3. **Reaper vs API**: Il reaper puo' uccidere una finestra mentre `sendKeysVerified` e' a meta' del flusso send→verify→retry

CC risolve questo con un promise-chain mutex:
```javascript
var gG8 = Promise.resolve();
function x96() {
  let H, $ = new Promise((L) => { H = L });
  let A = gG8;
  gG8 = $;
  return A.then(() => H);
}
```

**Fix**: Implementare un mutex per-window (o globale) con pattern simile.

---

### H4. Regex permessi incomplete — MCP, workspace trust, batch edit

**File:** `src/terminal-parser.ts:46-60`
**Impatto:** Nuovi tipi di prompt permesso CC non rilevati → sessione in stall silenzioso.

Pattern attuali coperti:
- `Do you want to proceed?`
- `Do you want to make this edit`
- `Do you want to create \S`
- `Do you want to delete \S`
- `❯ 1. Yes` (menu numerato)

**Pattern mancanti** (rilevati dall'analisi CC):

```typescript
// Aggiungere a top patterns di permission_prompt:
/^\s*Do you want to allow Claude to make these changes/,  // batch edit
/^\s*Do you want to allow Claude to use/,                // MCP tool
/^\s*Do you want to trust this (project|workspace)/,     // workspace trust
/^\s*Do you want to allow (reading|writing)/,            // file scope
/^\s*Do you want to run this command/,                   // alt bash approval
/^\s*Continue\?/,                                        // continuation prompt
/^\s*Do you want to allow writing to/,                   // file write scope
```

---

### H5. Variabile `$TMUX` non gestita — cambia comportamento CC

**File:** `src/tmux.ts` (env handling per CC launch)
**Impatto:** CC eredita `$TMUX` dalla sessione Aegis, attivando comportamenti indesiderati:

| Effetto | Dettaglio |
|---------|-----------|
| **Swarm split-pane** | Se CC lancia teammates, tenta split-pane nella sessione Aegis invece di socket isolato |
| **Color cap** | CC riduce colori a 256 (cosmetico, low impact) |
| **Clipboard passthrough** | CC usa `tmux load-buffer` per clipboard |
| **Escape wrapping** | OSC 52 wrapped in `DCS tmux;...ST` |

**Fix**: Unset `TMUX` e `TMUX_PANE` prima di lanciare CC:

```typescript
// In setEnvSecure o nel comando CC launch
env.TMUX = '';
env.TMUX_PANE = '';
// Oppure nel comando tmux send-keys:
await this.tmux('send-keys', '-t', windowId,
  'unset TMUX TMUX_PANE && claude --session-id ...', 'Enter');
```

---

### H6. StopFailure hook — campi persi

**File:** `src/hook.ts:39-63`
**Impatto:** Aegis cattura solo `error` e `stop_reason` da StopFailure. CC fornisce anche `error_details`, `last_assistant_message`, `agent_id` — informazioni critiche per debugging e recovery intelligente.

```typescript
// ATTUALE (hook.ts:53-59)
const error = (payload as any).error || (payload as any).message;
// error_details, last_assistant_message, agent_id — PERSI

// FIX — catturare tutti i campi
const signal = {
  error: payload.error,
  error_details: payload.error_details,
  last_assistant_message: payload.last_assistant_message,
  agent_id: payload.agent_id,
  stop_reason: payload.stop_reason,
};
```

---

### H7. Dead session detection non verifica processo vivo

**File:** `src/monitor.ts:408-424`
**Impatto:** Una finestra tmux puo' esistere con un processo CC crashato/zombie dentro. `isWindowAlive` controlla solo che la finestra esista, non che il processo sia vivo.

**Fix**: Aggiungere check processo:
```typescript
// Dopo window exists check:
const panePid = await this.tmux.listPanePid(session.windowId);
if (panePid) {
  try {
    process.kill(panePid, 0); // signal 0 = check if alive
  } catch {
    // Process is dead — mark as dead
  }
}
```

---

### H8. Stall detection non distingue API rate-limit da lavoro attivo

**File:** `src/monitor.ts:126-155`, `src/transcript.ts:92-177`
**Impatto:** Quando CC hitta rate-limit (429), entra backoff interno che puo' durare minuti. Aegis vede `working` + possibili byte JSONL (retry log entries) → stall timer non scatta. Aegis non ha modo di distinguere "computing" da "waiting on API retry".

**Fix**: Parsare `stop_reason` e contenuto errori nei JSONL entries:
```typescript
// In parseEntries — aggiungere check per error indicators
if (entry.message?.stop_reason === 'rate_limit' ||
    entry.message?.stop_reason === 'overloaded') {
  parsed.rateLimited = true;
}
```

---

### H9. No awareness teammate/subagent in Telegram

**File:** `src/channels/telegram.ts`
**Impatto:** Quando CC spawna teammates (agent swarms), Aegis non ha modo di:
- Rilevare che un teammate e' stato spawnato
- Collegare l'attivita' del teammate al topic parent
- Mostrare stato aggregato nel topic parent

CC spawna teammate con flag `--agent-id`, `--agent-name`, `--team-name`, `--parent-session-id`. Questi sono disponibili via process inspection del tmux pane.

---

### H10. No stato `error` nel terminal parser

**File:** `src/terminal-parser.ts`
**Impatto:** Quando CC incontra errori API, rate limit, o auth failure, mostra un messaggio di errore e torna al prompt. Aegis rileva `idle` (perche' `❯` riappare). Gli errori passano inosservati fino a che l'utente non controlla manualmente.

**Fix**: Aggiungere stato `error` cercando pattern tipo:
```typescript
{
  name: 'error',
  top: [/Error:/, /Rate limit/, /Authentication failed/, /overloaded/i],
  bottom: [/^\s*❯\s*$/],
  minGap: 1,
}
```

---

## 3. MEDIUM — Gap Funzionali e Miglioramenti

### M1. Socket isolation tmux

**File:** `src/tmux.ts:25`
Aegis usa sessione singola "aegis". CC usa `-L claude-swarm-{pid}` per isolamento. Se due istanze Aegis girano sulla stessa macchina, condividono la stessa sessione tmux.

**Fix**: Usare `-L aegis-{pid}` per isolare il server tmux.

---

### M2. Hook ignora 6 di 8 campi CC SessionStart

**File:** `src/hook.ts:73`

CC fornisce: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `agent_id`, `source`, `agent_type`, `model`.
Aegis cattura solo: `session_id`, `cwd`.

Campi persi rilevanti:
- `transcript_path` → elimina filesystem scan per JSONL discovery
- `source` (startup/resume/clear/compact) → reset corretto byte offsets
- `model` → metriche per-session
- `permission_mode` → verifica mode effettiva

---

### M3. `transcript_path` dal hook — ottimizzazione discovery

**File:** `src/hook.ts:73`, `src/session.ts:740`

CC fornisce il percorso esatto del file JSONL nel hook. Aegis ignora questo campo e invece esegue una filesystem scan (`findSessionFile`) ogni 3s per sessione fino a trovare il file.

**Fix**: Scrivere `transcript_path` in `session_map.json` e usarlo direttamente in `syncSessionMap`.

---

### M4. Campo `source` non tracciato (resume/clear/compact)

**File:** `src/hook.ts:73`, `src/session.ts:18`

CC distingue `startup`, `resume`, `clear`, `compact` nel SessionStart hook. Aegis non distingue — tratta tutto come fresh start.

- `clear` → JSONL riscritto, byte offsets andrebbero resettati
- `compact` → JSONL可能在offset变化, full re-read needed
- `resume` → byte offsets corretti, log per osservabilita'

---

### M5. Spinner richiede `...`/`…` nella stessa riga

**File:** `src/terminal-parser.ts` — `hasSpinnerAnywhere`

CC a volte renderizza spinner senza ellipsis (es. `✻ Thinking`). La funzione richiede spinner + `...` sulla stessa riga → operazioni brevi non rilevate.

**Fix**: Rimuovere il requisito ellipsis o renderlo opzionale.

---

### M6. Idle prompt parziale non rilevato

**File:** `src/terminal-parser.ts:160`

Se l'utente ha digitato input parziale (`❯ some text...`), `hasIdlePrompt` ritorna false → stato `unknown` invece di `idle`.

---

### M7. Permission guard controlla solo `settings.local.json`

**File:** `src/permission-guard.ts:23`

Non controlla:
- `.claude/settings.json` (committed nel repo)
- `~/.claude/settings.json` (user-level)
- Flag `allowDangerouslySkipPermissions`

---

### M8. Solo 2 di 5 modalita' permesso CC supportate

**File:** `src/tmux.ts:198-205`

Aegis mappa `autoApprove: boolean` a due mode:
- `true` → `bypassPermissions`
- `false` → `default`

Mode mancanti:
- `acceptEdits` — auto-approve file edits, prompt bash
- `plan` — solo pianificazione
- `dontAsk` — nega se non pre-approvato

**Fix**: Sostituire boolean con enum `permissionMode`.

---

### M9. Approve invia "y" incondizionatamente

**File:** `src/session.ts:428`

CC a volte mostra opzioni numerate (1. Yes, 2. Yes+settings, 3. No). Inviare "y" non seleziona l'opzione corretta. Telegram ha dynamic buttons che gestiscono questo, ma l'API `POST /approve` e l'auto-approve del monitor no.

---

### M10. No circuit breaker per canali fallenti

**File:** `src/channels/manager.ts:76-90`

Se Telegram token e' revocato o webhook e' permanentemente down, Aegis tenta delivery su ogni evento + logga errore. Per sessioni attive con dozzine di eventi/min, questo produce log noise e API calls sprecate.

**Fix**: Circuit breaker — disabilita canale dopo N fallimenti consecutivi, retry dopo cooldown.

---

### M11. No jitter su webhook exponential backoff

**File:** `src/channels/webhook.ts:124`

Backoff esatto: 500ms, 1000ms, 2000ms. Multipli webhook simultanei retry allo stesso istante → thundering herd.

**Fix**: `delay * (0.5 + Math.random() * 0.5)`

---

### M12. No eventi SSE per stall e dead sessions

**File:** `src/events.ts:58-99`

Il monitor emette `status.stall` e `status.dead` solo ai channels. SSE subscribers (web dashboards) non ricevono questi eventi.

---

### M13. Polling 2s su tutti i state changes

**File:** `src/monitor.ts:29`

Latency fino a 2s su ogni cambio stato. Per auto-approve, aggiunge 2s di delay inutile prima dell'approvazione.

`fs.watch()` su JSONL potrebbe eliminare il polling per i cambiamenti di contenuto, lasciando il polling solo per UI state via capture-pane.

---

### M14. No metriche latenza

**File:** `src/metrics.ts:12-27`

Aegis traccia *cosa* e' successo ma non *quanto velocemente*. Mancano:
- Tempo da CC state change → Aegis detection
- Tempo da detection → channel delivery
- Tempo da permission prompt → user action

---

### M15. No rilevamento workspace trust / cost confirmation

**File:** `src/terminal-parser.ts`

CC mostra prompt per "trust this workspace" e "cost confirmation" prima di operazioni costose. Non rilevati da Aegis.

---

### M16. `permission_request` contentType definito ma mai usato

**File:** `src/transcript.ts:19`

`ParsedEntry.contentType` include `'permission_request'` ma nessun code path lo setta mai.

---

### M17. `progress` JSONL entries ignorati

**File:** `src/transcript.ts:47-48,97`

CC scrive `progress` entries per operazioni lunghe. Aegis le parsa ma le salta silenziosamente.

---

### M18. `tool_result` con `is_error: true` non differenziato

**File:** `src/transcript.ts:145-169`

Errori tool result trattati identicamente a successi.

---

### M19. Dead detection accoppiata a intervallo stall

**File:** `src/monitor.ts:97-103`

Dead detection e stall detection condividono lo stesso timer (30s). Dead sessions sono piu' urgenti e potrebbero beneficiare di intervallo indipendente e piu' breve.

---

### M20. Settings bottom patterns senza anchor `^\s*`

**File:** `src/terminal-parser.ts`

Pattern come `/Esc to cancel/`, `/Enter to confirm/` non hanno anchor iniziale. Testo conversazione contenente "Esc" o "Enter" puo' causare false positive per stato `settings`.

---

### M21. No position awareness nel pattern matching

**File:** `src/terminal-parser.ts` — `tryMatchPattern`

I pattern top non distinguono posizione nel pane. CC mostra prompt interattivi in basso, ma match puo' avvenire su testo nello scrollback. Limitare il match alle ultime N righe ridurrebbe false positive.

---

### M22. Transient "unknown" durante re-render Ink

**File:** `src/terminal-parser.ts`

Ink (React CLI di CC) fa rapid screen update. `capture-pane` durante un re-render puo' catturare un frame parziale → transient `unknown`.

---

### M23. Idle debounce nasconde completamenti brevi

**File:** `src/monitor.ts:374`

Debounce 10s significa che task completati in <10s non generano mai notifica idle. Per monitoring dashboards, un evento "briefly idle" sarebbe utile.

---

### M24. Telegram permission buttons non capiscono 5 mode CC

**File:** `src/channels/telegram.ts:221-260`

Aegis auto-approve e' binario. In modalita' `acceptEdits` di CC, gli edit sono auto-approved ma bash commands richiedono prompt. Aegis non puo' distinguere tra i due.

---

### M25. No SubagentStart/Stop hooks gestiti

**File:** `src/hook.ts:151-202`

CC spawna subagenti in-process con hook `SubagentStart`/`SubagentStop`. Aegis registra solo `SessionStart`, `Stop`, `StopFailure`.

---

### M26. Hook failures completamente silenti — no metriche

**File:** `src/hook.ts:78,85,99,107,117`

Hook fallisce → `process.exit(0)`. CC vede successo ma nessun mapping scritto. Aegis non ha modo di sapere che l'hook e' fallito. Nessuna metrica su delivery rate hook.

---

### M27. Per-session metrics non persistiti

**File:** `src/metrics.ts:56`

`perSession` e' una Map in-memory. Global metrics sono persistiti su disco, ma per-session metrics vanno persi al restart.

---

## 4. LOW — Nice-to-Have e Technical Debt

| # | Finding | File | Dettaglio |
|---|---------|------|-----------|
| L1 | Retry con backoff lineare, non esponenziale | `tmux.ts:110-158` | Window creation: 500ms, 1000ms. Esponenziale (500, 1500, 4500) migliore per overload |
| L2 | `listWindows()` ritorna `[]` su errore (silent fail) | `tmux.ts:60-75` | Non distingue "no windows" da "tmux broken" |
| L3 | `killWindow()` swallows tutti gli errori | `tmux.ts:493-500` | Corretto (idempotent) ma nessun feedback |
| L4 | No debounce post-operazioni tmux | `tmux.ts` | CC ha 200ms debounce. Aegis usa fixed delays (1-2s) — sufficienti |
| L5 | Nome finestra collision check non atomico | `tmux.ts:90-97` | Tra list e create, altra request puo' creare stesso nome |
| L6 | No `killSession()` metodo pubblico | `tmux.ts` | Solo `killWindow`. Sessione corrotta non pulita |
| L7 | Error handling inconsistente (swallow/throw/return) | `tmux.ts` | Decidere strategia fail-fast vs graceful e applicare coerentemente |
| L8 | Permission stall threshold non per-session | `monitor.ts:32` | 5min hardcoded, non configurabile via API |
| L9 | No auto-reject dopo timeout permesso | `monitor.ts` | Stall notification solo informativa, nessuna escalation |
| L10 | No heartbeat SSE per sessioni attive | `events.ts:12` | Tipo definito ma mai emesso |
| L11 | SSE message events mancano tool metadata | `events.ts:68-75` | `toolName`, `toolUseId` disponibili ma non inclusi |
| L12 | Telegram message queue senza backpressure | `telegram.ts:664` | Nessun drop policy per overflow |
| L13 | Webhook retry: 3 tentativi, 3.5s totali | `webhook.ts:76-77` | Potrebbe essere insufficiente per outage lunghi |
| L14 | No dead letter queue per webhook falliti | `webhook.ts:130` | Payload persi dopo 3 retry |
| L15 | No per-channel health reporting | `manager.ts:86` | Impossibile determinare da API se Telegram fallisce |
| L16 | "Aborted" non escluso da working detection | `terminal-parser.ts` | "Worked for" e "Compacted" esclusi, "Aborted" no |
| L17 | `parseStatusLine` controlla solo 5 righe sopra separator | `terminal-parser.ts` | Spinner piu' in alto non rilevato |
| L18 | No test per braille spinners | `__tests__/terminal-parser.test.ts` | Gap piu' critico nei test |
| L19 | No test per MCP tool permission prompts | `__tests__/terminal-parser.test.ts` | |
| L20 | No test per idle prompt parziale | `__tests__/terminal-parser.test.ts` | |
| L21 | No test per settings false positive | `__tests__/terminal-parser.test.ts` | |
| L22 | No test per transient re-render state | `__tests__/terminal-parser.test.ts` | |
| L23 | DCS passthrough leak in capture-pane | `tmux.ts:489` | Teorico, dipende da versione tmux |
| L24 | `permission_mode` dal hook non verificato | `hook.ts`, `tmux.ts:198` | Hook potrebbe confermare mode ricevuto da CC |
| L25 | `model` field non catturato | `hook.ts:73` | Potenziale per metriche costo |
| L26 | WorktreeCreate/Remove hooks non gestiti | `hook.ts:151-202` | CC gestisce worktree tmux in modo indipendente |
| L27 | Auto-approve ridondante con bypassPermissions | `monitor.ts:344-358` | Monitor auto-approve path = dead code quando bypassPermissions attivo |
| L28 | CC telemetry events non mirati da hook | `metrics.ts` | Hook riceve source, agent_id, model ma non li traccia |
| L29 | Env vars CC (`CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL`) non set by default | `tmux.ts:284` | Utenti devono usare `defaultSessionEnv` |
| L30 | No rilevamento `compact`/`compacting` state | `terminal-parser.ts` | |
| L31 | No rilevamento `context_window_warning` | `terminal-parser.ts` | |
| L32 | No differenziazione `waiting_for_input` vs `idle` | `terminal-parser.ts` | |
| L33 | `system` JSONL entries non differenziati | `transcript.ts:99` | System messages (hook context injection) trattate come user |
| L34 | No test per permission prompt con diff preview lungo | `__tests__/terminal-parser.test.ts` | |
| L35 | No test per chrome separator false positive | `__tests__/terminal-parser.test.ts` | |
| L36 | No test per multipli stati interattivi nello stesso pane | `__tests__/terminal-parser.test.ts` | |

---

## 5. Nuove Feature Idee da CC

### F1. Agent Swarm Awareness

CC spawna teammate in tmux con naming prevedibile:
- Sessione: `claude-swarm-{pid}` (socket isolato `-L`)
- Finestra: `teammate-{name}`
- Env vars: `--agent-id`, `--agent-name`, `--team-name`, `--parent-session-id`

**Feature**: Monitorare swarm socket per nuove finestre, cross-reference con session_map.json, mostrare stato aggregato nel topic Telegram parent.

### F2. PermissionRequest Hook Integration

CC ha hook `PermissionRequest` che fire prima che il prompt sia mostrato. Aegis registra permission via terminal regex polling (2s latency). Hook `PermissionRequest` eliminerebbe la latency per l'evento piu' time-sensitive.

### F3. TaskCompleted Hook

CC fire `TaskCompleted` hook con contesto (task name, result, duration). Aegis inferisce completion da idle transition. Hook fornirebbe signal esplicito.

### F4. Per-Session Permission Mode Enum

Sostituire `autoApprove: boolean` con `permissionMode: "default" | "bypassPermissions" | "acceptEdits" | "plan" | "dontAsk"`.

### F5. Event-Driven JSONL Monitoring

Sostituire polling 2s JSONL con `fs.watch()` (inotify su Linux). Mantenere polling solo per capture-pane UI state detection.

### F6. Pane Metadata via tmux

CC usa `select-pane -T {title}` e `set-option pane-border-format` per metadata visivi. Aegis potrebbe usare questi per:
- Scrivere session ID nel pane title (visibile in `tmux list-windows`)
- Scrivere stato Aegis nel border format (per debug visivo)

### F7. tmux Socket Isolation

Usare `-L aegis-{pid}` per:
- Prevenire collisioni multi-istanza
- Isolare da CC swarm behavior
- Prevenire interazione con sessione tmux utente

### F8. Error State Detection nel Terminal Parser

Nuovo stato `error` che cattura:
- API errors (429, 500, auth)
- Rate limiting
- Context window overflow

Attiverebbe notifiche immediate via Telegram/webhook.

### F9. Latency Metrics Dashboard

Aggiungere metriche timing:
- `state_change_detection_ms`
- `channel_delivery_ms`
- `permission_response_ms`

Esporre via `GET /v1/metrics`.

### F10. Subagent Lifecycle Tracking

Registrare hook `SubagentStart`/`SubagentStop` per tracciare subagenti CC in-process. Mostrare nella progress card Telegram.

---

## 6. Matrice Completa dei Findings

| ID | Area | Finding | Impact | Effort |
|----|------|---------|--------|--------|
| H1 | tmux | Timeout mancanti comandi tmux | HIGH | Low |
| H2 | parser | Braille spinners mancanti | HIGH | Low |
| H3 | tmux | Mutex/serializzazione mancante | HIGH | Medium |
| H4 | parser | Regex permessi incomplete | HIGH | Low |
| H5 | tmux | $TMUX non gestita | HIGH | Low |
| H6 | hooks | StopFailure campi persi | HIGH | Low |
| H7 | monitor | Dead detection non verifica processo | HIGH | Medium |
| H8 | monitor | API rate-limit stall invisibile | HIGH | Medium |
| H9 | telegram | No awareness teammate/subagent | HIGH | High |
| H10 | parser | No stato error | HIGH | Low |
| M1 | tmux | Socket isolation mancante | MEDIUM | Low |
| M2 | hooks | Hook ignora 6/8 campi CC | MEDIUM | Low |
| M3 | hooks | transcript_path non usato | MEDIUM | Low |
| M4 | hooks | Campo source non tracciato | MEDIUM | Low |
| M5 | parser | Spinner richiede ellipsis | MEDIUM | Low |
| M6 | parser | Idle prompt parziale | MEDIUM | Low |
| M7 | perms | Guard solo settings.local.json | MEDIUM | Low |
| M8 | perms | Solo 2/5 mode supportate | MEDIUM | Medium |
| M9 | perms | Approve invia "y" incondizionatamente | MEDIUM | Low |
| M10 | channels | No circuit breaker | MEDIUM | Medium |
| M11 | webhook | No jitter backoff | MEDIUM | Low |
| M12 | sse | No eventi stall/dead SSE | MEDIUM | Low |
| M13 | monitor | Polling 2s latency | MEDIUM | Medium |
| M14 | metrics | No metriche latenza | MEDIUM | Medium |
| M15 | parser | No workspace trust detection | MEDIUM | Low |
| M16 | transcript | permission_request unused | MEDIUM | Low |
| M17 | transcript | progress entries ignorati | MEDIUM | Low |
| M18 | transcript | tool_result is_error ignorato | MEDIUM | Low |
| M19 | monitor | Dead detection accoppiata a stall | MEDIUM | Low |
| M20 | parser | Settings patterns senza anchor | MEDIUM | Low |
| M21 | parser | No position awareness matching | MEDIUM | Low |
| M22 | parser | Transient unknown re-render | MEDIUM | Low |
| M23 | monitor | Idle debounce nasconde brevi | MEDIUM | Low |
| M24 | telegram | Buttons non 5-mode aware | MEDIUM | Medium |
| M25 | hooks | No SubagentStart/Stop | MEDIUM | Low |
| M26 | hooks | Hook failures no metriche | MEDIUM | Low |
| M27 | metrics | Per-session non persistiti | MEDIUM | Low |
| L1-L36 | vari | Vedi sezione 4 | LOW | Mixed |

---

_Report generato dallo swarm di analisi Hephaestus, 2026-03-24_

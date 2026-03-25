# Claude Code v2.1.81 — Analisi Completa dell'Integrazione tmux

**Data:** 2026-03-24
**Fonte:** Bundle estratto da `/tmp/claude-extracted/` (32 files, ~18MB)
**Metodo:** Swarm di 5 agenti paralleli con focus tmux

---

## Indice

1. [Panoramica del Bundle](#1-panoramica-del-bundle)
2. [Come Claude Code Usa tmux](#2-come-claude-code-usa-tmux)
3. [Architettura del TmuxBackend](#3-architettura-del-tmuxbackend)
4. [Agent Swarms — Spawning dei Teammates](#4-agent-swarms--spawning-dei-teammates)
5. [Worktree Integration](#5-worktree-integration)
6. [Gestione Sessione tmux Interna](#6-gestione-sessione-tmux-interna)
7. [Hook System](#7-hook-system)
8. [Gestione Permessi](#8-gestione-permessi)
9. [Comportamento in Contesto tmux](#9-comportamento-in-contesto-tmux)
10. [Tool Definitions e System Prompts](#10-tool-definitions-e-system-prompts)
11. [Errori e Messaggi tmux](#11-errori-e-messaggi-tmux)
12. [Implicazioni per Aegis](#12-implicazioni-per-aegis)

---

## 1. Panoramica del Bundle

### Files analizzati

| File | Dimensione | Contenuto |
|------|-----------|-----------|
| `claude-code-main.js` | 11.7 MB | Bundle principale — contiene **tutta** la logica tmux |
| `module-cli-3869558.js` | 72 KB | Moduli Bun interni, **zero** riferimenti tmux |
| `module-bun-internal-852753.js` | 2.8 MB | Runtime Bun, nessun tmux |
| `system-prompt-full.txt` | 2.2 KB | System prompt — nessun riferimento tmux diretto |
| `system-prompt-env.txt` | 20 KB | Contesto ambiente — nessun tmux |
| `tool-definitions-full.txt` | 500 KB | Definizioni tool — **zero** tool tmux |
| `tool-schemas-main.txt` | 1 MB | Schemi tool — 2 sole menzioni tmux |
| `tool-descriptions.txt` | 30 KB | Descrizioni tool — tmux indiretto |
| `tool-impl-section.txt` | 50 KB | Implementazioni tool — zero tmux |
| `claude-core-strings.txt` | 60 KB | Stringhe core — nessun tmux |
| `bash-completion.sh` | 95 KB | Completamento bash — zero tmux |
| `react-hooks-region.txt` | 130 KB | React hooks — zero tmux |
| `anthropic-api-region.txt` | 120 KB | API layer — 1 riferimento (detection) |
| `src/entrypoints/cli.js` | ~16 KB | Entry point CLI — tmux detection + swarm setup |

### Versione analizzata

```
Claude Code v2.1.81
Build: 2026-03-20
Runtime: Node.js 22+ / Bun
Rendering: Ink (React per CLI)
```

---

## 2. Come Claude Code Usa tmux

### Scoperta fondamentale

**Claude Code NON usa tmux per la propria sessione primaria.** Il rendering avviene tramite il framework **Ink** (React per terminale) che scrive direttamente su stdout e legge da stdin. CC non usa mai:

- `capture-pane` — **0 occorrenze** nell'intero bundle
- `send-keys` per interagire con la propria UI
- Qualsiasi API tmux per leggere il proprio stato

### I due soli casi d'uso tmux

| # | Caso d'uso | Descrizione |
|---|-----------|-------------|
| 1 | **Agent Swarms** | Spawning di teammate agents in pane/window tmux separati |
| 2 | **Worktree Sessions** | `--tmux --worktree` crea sessioni tmux isolate per worktree |

### Implicazione

Claude Code e' un'applicazione TUI standard che legge stdin e scrive stdout. **Non ha alcuna consapevolezza di essere dentro tmux** (a livello di sessione propria). Questo significa che Aegis, wrappando CC in tmux e usando `send-keys` + `capture-pane`, sta facendo qualcosa che CC non fa internamente — e' l'unico modo possibile per controllarlo a livello di terminale.

---

## 3. Architettura del TmuxBackend

### Gerarchia delle classi

```
BackendRegistry (selezione backend)
  ├── TmuxBackend (nCA)          — tmux native
  ├── ITermBackend (rCA)         — iTerm2 native split panes
  └── InProcessBackend           — no tmux, tutto in-process
```

### Selezione del backend

La priorita' di selezione e':

```
1. Gia' dentro tmux ($TMUX settato)        → TmuxBackend (split-pane mode)
2. Dentro iTerm2 ($TERM_PROGRAM=iTerm.app) → ITermBackend (fall back → tmux)
3. preferTmuxOverIterm2: true in settings  → Forza TmuxBackend
4. tmux installato ma non attivo           → TmuxBackend (external session mode)
5. Nessuno dei due                          → Errore + istruzioni installazione
6. Fallback                                → InProcessBackend (no tmux)
```

### Rilevamento tmux

```javascript
// Variabili catturate a module-load time
var EG8 = process.env.TMUX;       // es. "/tmp/tmux-1000/default,12345,0"
var h96 = process.env.TMUX_PANE;  // es. "%5"

// Check sincrono (cached dopo prima chiamata)
function xu() {
  if (RQH !== null) return RQH;
  return RQH = !!process.env.TMUX;
}

// Check asincrono (per BackendRegistry)
async function H$H() {
  return (await wA("tmux", ["-V"])).code === 0;
}

// Check sincrono (per worktree fast path)
// vG.spawnSync("tmux", ["-V"], {encoding: "utf-8"}).status !== 0
```

Il rilevamento e' **puramente basato su variabili d'ambiente** — nessun ispezione del process tree.

### Funzione wrapper per comandi tmux

Due wrapper eseguono comandi tmux:

```javascript
// Wrapper per sessione tmux corrente (dentro tmux)
function mu(args) {
  return wA("tmux", args);
}

// Wrapper per socket isolato swarm
function Y0(args) {
  return wA("tmux", ["-L", S2H(), ...args]);
  // S2H() = "claude-swarm-{process.pid}"
}

// wA e' il wrapper generico con timeout default
function wA(cmd, args, opts = {
  timeout: 10 * B$A * p$A,  // timeout calcolato
  preserveOutputOnError: true,
  useCwd: true
}) { ... }
```

### Mutex di serializzazione

Tutte le operazioni tmux per creazione panes passano attraverso un mutex:

```javascript
var gG8 = Promise.resolve();  // promise chain globale

function x96() {
  let H, $ = new Promise((L) => { H = L });
  let A = gG8;
  gG8 = $;
  return A.then(() => H);
}
```

Questo previene race conditions quando multipli comandi tmux devono eseguire in sequenza (split → set color → set title → rebalance).

### Debounce post-operazione

```javascript
var b96 = 200;  // 200ms

function UG8() {
  return new Promise((H) => setTimeout(H, b96));
}
```

Dopo ogni operazione di layout, CC attende 200ms prima della prossima operazione per permettere a tmux di stabilizzarsi.

---

## 4. Agent Swarms — Spawning dei Teammates

### Costanti

| Costante | Valore | Scopo |
|----------|--------|-------|
| `z0` | `"tmux"` | Nome binario tmux |
| `UT` | `"claude-swarm"` | Prefisso nome sessione |
| `h2H` | `"swarm-view"` | Nome finestra iniziale |
| `jCA` | `"claude-hidden"` | Sessione nascosta per hide/show |
| `PM` | `"team-lead"` | Identificatore ruolo leader |
| `R2H` | `"CLAUDE_CODE_TEAMMATE_COMMAND"` | Env var override comando teammate |
| `S2H()` | `"claude-swarm-{process.pid}"` | Suffisso socket per sessioni swarm |

### Impostazione teammateMode

```javascript
teammateMode: {
  source: "global",
  type: "string",
  description: 'How to spawn teammates: "tmux" for traditional tmux, "in-process" for same process, "auto" to choose automatically',
  options: ["auto", "tmux", "in-process"]
}
```

### Modalita' A: Split-Pane (dentro tmux)

Quando CC gira gia' dentro tmux (`$TMUX` settato):

1. Ottiene il pane ID corrente tramite `$TMUX_PANE` o `display-message -p "#{pane_id}"`
2. Ottiene il window target: `display-message -p "#{session_name}:#{window_index}"`
3. Se c'e' 1 solo pane: `split-window -t {pane} -h -l 70% -P -F "#{pane_id}"` (leader mantiene 70%)
4. Se ci sono piu' pane: seleziona il **pane centrale**, split alternato verticale/orizzontale
5. Imposta colore bordo, titolo pane, e rebalance

### Modalita' B: External Session (fuori tmux)

Quando CC **non** gira dentro tmux:

1. Crea sessione detached con socket isolato:
   ```
   tmux -L claude-swarm-{pid} new-session -d -s claude-swarm -n swarm-view -P -F "#{pane_id}"
   ```
2. Per ogni teammate:
   ```
   tmux -L claude-swarm-{pid} new-window -t claude-swarm -n teammate-{name} -P -F "#{pane_id}"
   ```
3. Invia il comando di avvio:
   ```
   tmux -L claude-swarm-{pid} send-keys -t claude-swarm:{window} "{command}" Enter
   ```
4. Il primo teammate riutilizza il pane iniziale; i successivi ottengono nuove finestre

### Comando di avvio teammate

```bash
cd {cwd} && env CLAUDECODE=1 \
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
  {claude_executable} \
  --agent-id {id} \
  --agent-name {name} \
  --team-name {team} \
  --agent-color {color} \
  --parent-session-id {parentId} \
  --permission-mode {mode} \
  --model {model}  # se specificato
```

Le env var passate ai teammate (`mQH()`):
- `CLAUDECODE=1`
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- `CLAUDE_CODE_USE_BEDROCK` (se settato)
- `CLAUDE_CODE_USE_VERTEX` (se settato)
- `CLAUDE_CODE_USE_FOUNDRY` (se settato)
- `ANTHROPIC_BASE_URL` (se settato)
- `CLAUDE_CONFIG_DIR` (se settato)
- `CLAUDE_CODE_REMOTE` (se settato)
- `CLAUDE_CODE_REMOTE_MEMORY_DIR` (se settato)

### Personalizzazione visiva panes

**Colori bordo:**
```javascript
async setPaneBorderColor(target, color) {
  const tmuxColor = {
    red: "red", blue: "blue", green: "green", yellow: "yellow",
    purple: "magenta", orange: "colour208", pink: "colour205", cyan: "cyan"
  }[color];
  await cmd(["select-pane", "-t", target, "-P", `bg=default,fg=${tmuxColor}`]);
  await cmd(["set-option", "-p", "-t", target, "pane-border-style", `fg=${tmuxColor}`]);
  await cmd(["set-option", "-p", "-t", target, "pane-active-border-style", `fg=${tmuxColor}`]);
}
```

**Titoli pane:**
```javascript
await cmd(["select-pane", "-t", target, "-T", title]);
await cmd(["set-option", "-p", "-t", target, "pane-border-format",
  `#[fg=${color},bold] #{pane_title} #[default]`]);
```

**Stato bordo:**
```javascript
await cmd(["set-option", "-w", "-t", windowTarget, "pane-border-status", "top"]);
```

### Hide/Show panes

```javascript
// Nasconde un pane nella sessione "claude-hidden"
async hidePane(target, useNamedSocket) {
  await cmd(["new-session", "-d", "-s", "claude-hidden"]);
  await cmd(["break-pane", "-d", "-s", target, "-t", "claude-hidden:"]);
}

// Mostra un pane joinandolo alla finestra destinazione
async showPane(target, dest, useNamedSocket) {
  await cmd(["join-pane", "-h", "-s", target, "-t", dest]);
  await cmd(["select-layout", "-t", dest, "main-vertical"]);
}
```

### Rebalance layout

**Con leader (main-vertical):**
```javascript
async rebalancePanesWithLeader(windowTarget) {
  let panes = (await mu(["list-panes", "-t", windowTarget, "-F", "#{pane_id}"]))
    .stdout.trim().split("\n");
  if (panes.length <= 2) return;
  await mu(["select-layout", "-t", windowTarget, "main-vertical"]);
  await mu(["resize-pane", "-t", panes[0], "-x", "30%"]);  // leader 30%
}
```

**Tiled (external swarm):**
```javascript
async rebalancePanesTiled(windowTarget) {
  let panes = (await Y0(["list-panes", "-t", windowTarget, "-F", "#{pane_id}"]))
    .stdout.trim().split("\n");
  if (panes.length <= 1) return;
  await Y0(["select-layout", "-t", windowTarget, "tiled"]);
}
```

### Kill pane

```javascript
async killPane(target, useNamedSocket) {
  return (await cmd(["kill-pane", "-t", target])).code === 0;
}
```

---

## 5. Worktree Integration

### Entry point: `execIntoTmuxWorktree` (funzione `XG6`)

Il "fast path" quando si lancia `claude --tmux --worktree`:

### Flusso completo

```
1. Check tmux installato      → spawnSync("tmux", ["-V"])
2. Parse argomenti CLI         → -w/--worktree name, --tmux=classic
3. Genera nome worktree        → random adjectives + animal + hex (es. "swift-fox-a3b2")
4. Crea git worktree           → git worktree add
5. Rileva tmux prefix          → tmux show-options -g prefix
6. Check conflitti prefix      → C-b, C-c, C-d, C-t, C-o, C-r, C-s, C-g, C-e
7. Set env vars                → CLAUDE_CODE_TMUX_SESSION, _PREFIX, _PREFIX_CONFLICTS
8. Check session esiste        → tmux has-session -t {name}
9. Detect iTerm2 vs tmux      → $TERM_PROGRAM, $ITERM_SESSION_ID
10. Crea/attach session        → 4 branch (vedi sotto)
```

### Generazione nome sessione

```javascript
function HUA(repoPath, worktreeName) {
  return `${basename(repoPath)}_${worktreeName}`.replace(/[/.]/g, "_");
}
// Esempio: "my-project_worktree-swift-fox-a3b2"
```

### Rilevamento conflitti prefix key

CC controlla se il prefix tmux dell'utente confligge con i keybinding di CC:

```
Conflittanti: C-b, C-c, C-d, C-t, C-o, C-r, C-s, C-g, C-e
```

Se rilevato, setta `CLAUDE_CODE_TMUX_PREFIX_CONFLICTS=1` e mostra istruzioni speciali:
```
Detach: {prefix} {prefix} d (press prefix twice - Claude uses {prefix})
```

### I 4 branch di creazione sessione

| Condizione | Azione |
|-----------|--------|
| iTerm2 + flag `-CC` | `tmux -CC attach-session -t {name}` oppure `tmux -CC new-session -A -s {name}` |
| Dentro tmux, sessione esiste | `tmux switch-client -t {name}` |
| Dentro tmux, nuova sessione | Crea detached poi `tmux switch-client` |
| Fuori tmux | `tmux new-session -A -s {name} -c {worktree} -- {node} {args}` (stdio inherit) |

### Env vars set per worktree tmux

```bash
CLAUDE_CODE_TMUX_SESSION={sessionName}
CLAUDE_CODE_TMUX_PREFIX={detected_prefix}
CLAUDE_CODE_TMUX_PREFIX_CONFLICTS=1  # se conflitto rilevato
```

### Telemetry

```javascript
c("tengu_worktree_created", { tmux_enabled: f });  // traccia se tmux usato
c("cli_tmux_worktree_fast_path");                   // evento fast path
```

### Ciclo di vita worktree tmux

| Azione | Comando | Quando |
|--------|---------|--------|
| Crea | `tmux new-session -d -s {name} -c {path}` | WorktreeCreate |
| Uccidi | `tmux kill-session -t {name}` | WorktreeRemove con action=remove |
| Mantieni | Sessione lasciata running | WorktreeRemove con action=keep |
| Riattacca | `tmux attach -t {name}` | Manuale dall'utente |

---

## 6. Gestione Sessione tmux Interna

### Error handling

**Nessun retry** sui comandi tmux — i fallimenti lanciano eccezioni immediatamente:

```javascript
// send-keys fallisce → throw
async sendCommandToPane(target, command, useNamedSocket) {
  let result = await (useNamedSocket ? Y0 : mu)(["send-keys", "-t", target, command, "Enter"]);
  if (result.code !== 0)
    throw Error(`Failed to send command to pane ${target}: ${result.stderr}`);
}
```

Questo e' un punto critico: **CC fa fire-and-forget con send-keys, senza alcuna verifica**. Non esiste nessun `sendKeysVerified()` equivalente a quello di Aegis.

### Timeout

Tutti i comandi tmux hanno un timeout calcolato (derivato da costanti `B$A` e `p$A`). Non c'e' retry automatico.

### Socket isolation

Le operazioni swarm usano un socket tmux dedicato:
```
-L claude-swarm-{pid}
```
Questo crea il socket in `$TMUX_TMPDIR/claude-swarm-{pid}-{uid}`, isolando completamente le sessioni swarm dalla sessione tmux utente.

### Tracking stato

Ogni teammate mantiene nello state:
```javascript
{
  tmuxSessionName: "claude-swarm",
  tmuxPaneId: "%5",
  tmuxWindowName: "teammate-agent-name"
}
```

---

## 7. Hook System

### Hook rilevanti per Aegis

#### SessionStart

```json
{
  "hook_event_name": "SessionStart",
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "permission_mode": "string?",     // opzionale
  "agent_id": "string?",            // opzionale, presente per subagenti
  "source": "startup | resume | clear | compact",
  "agent_type": "string?",          // opzionale
  "model": "string?"                // opzionale
}
```

Output consentito:
- `additionalContext`: stringa accodata al system prompt
- `initialUserMessage`: stringa usata come primo messaggio utente

#### SessionEnd

```json
{
  "hook_event_name": "SessionEnd",
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string"
}
```

#### StopFailure

```json
{
  "hook_event_name": "StopFailure",
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "error": "string",
  "error_details": "string?",
  "last_assistant_message": "string?",
  "agent_id": "string?"
}
```

#### WorktreeCreate / WorktreeRemove

```json
// WorktreeCreate
{ "hook_event_name": "WorktreeCreate", "name": "string" }

// WorktreeRemove
{ "hook_event_name": "WorktreeRemove", "worktree_path": "string" }
```

#### Altri hook rilevanti

| Hook | Contesto |
|------|----------|
| `TeammateIdle` | Teammate inattivo, include `blockingError` |
| `TaskCompleted` | Task completata |
| `PermissionRequest` | Richiesta permesso |
| `PreToolUse` | Prima dell'uso di un tool |
| `PostToolUse` | Dopo l'uso di un tool |
| `SubagentStart` / `SubagentStop` | Lifecycle subagenti |

---

## 8. Gestione Permessi

### Modalita' permesso

| Modalita | Flag CLI | Comportamento |
|----------|----------|---------------|
| Bypass | `--permission-mode bypassPermissions` | Salta tutti i prompt (richiede `allowDangerouslySkipPermissions: true`) |
| Accept Edits | `--permission-mode acceptEdits` | Auto-accetta operazioni di edit |
| Plan | `--permission-mode plan` | Modalita' pianificazione, nessuna esecuzione tool |
| Don't Ask | `--permission-mode dontAsk` | Nega se non pre-approvato |
| Default | (nessun flag) | Prompting interattivo |

I permessi sono passati ai teammate via `--permission-mode {mode}` e sono disponibili nell'hook input JSON.

---

## 9. Comportamento in Contesto tmux

### Rilevamento tipo terminale

CC identifica tmux nella catena di detection:

```
vscode → pycharm → ghostty → kitty → tmux ($TMUX) → screen ($STY) → konsole → gnome-terminal → xterm
```

### Riduzione colori

Quando `$TMUX` e' settato, CC riduce il livello di colore:

```javascript
function dY1() {
  if (process.env.TMUX && L$.level > 2) return L$.level = 2, true;
  return false;
}
```

**Chalk color level capped a 2** (256 colori) dentro tmux. Questo potrebbe influenzare il terminal parsing di Aegis se dipende da codici colore per detectare stati.

### Clipboard passthrough

```javascript
if (process.env.TMUX) {
  let args = process.env.LC_TERMINAL === "iTerm2"
    ? ["load-buffer", "-"]
    : ["load-buffer", "-w", "-"];
  await wA("tmux", args, { input: clipboardContent });
}
```

### Escape sequence wrapping per tmux

```javascript
function Yv(H) {
  if (process.env.TMUX)
    return `\x1BPtmux;${H.replaceAll("\x1B", "\x1B\x1B")}\x1B\\`;
  if (process.env.STY)
    return `\x1BP${H}\x1B\\`;  // GNU screen
  return H;
}
```

OSC 52 clipboard sequences sono wrapped nel protocollo tmux passthrough (`DCS tmux;...ST`), raddoppiando tutti gli escape bytes.

### TMUX env var nei comandi bash

```javascript
async getEnvironmentOverrides(commandText) {
  let mentionsTmux = commandText.includes("tmux");
  let savedTmux = zA8();  // attualmente restituisce null
  let overrides = {};
  if (savedTmux) overrides.TMUX = savedTmux;
  // ... altre env vars
  return overrides;
}
```

Quando un comando bash contiene "tmux", CC tenta di preservare la variabile `$TMUX`. **La funzione `zA8()` attualmente restituisce `null`** — lo stub suggerisce che il meccanismo save/restore non e' completo.

### Variabili ambiente lette da CC

| Variabile | Scopo |
|-----------|-------|
| `TMUX` | Rileva esecuzione dentro tmux |
| `TMUX_PANE` | Identifica il pane corrente |
| `TERM_PROGRAM` | Rileva iTerm2 |
| `ITERM_SESSION_ID` | Rileva iTerm2 alternativo |

### Variabili ambiente scritte da CC

| Variabile | Scopo |
|-----------|-------|
| `CLAUDE_CODE_TMUX_SESSION` | Nome sessione tmux creata da CC |
| `CLAUDE_CODE_TMUX_PREFIX` | Prefix key tmux rilevato |
| `CLAUDE_CODE_TMUX_PREFIX_CONFLICTS` | `"1"` se conflitto keybinding |
| `CLAUDE_CODE_TEAMMATE_COMMAND` | Override path eseguibile per teammate |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `=1` per teammate subprocess |

---

## 10. Tool Definitions e System Prompts

### Nessun tool tmux esposto

**Zero tool tmux nelle definizioni tool.** tmux e' interamente infrastruttura interna — non esposto come tool all'LLM.

Le uniche menzioni tmux negli schemi tool:
1. Array opzioni teammateMode: `["auto", "tmux", "in-process"]`
2. Campo `pid` nello schema init: `"@internal CLI process PID for tmux socket isolation"`

### System prompt

Il system prompt non menziona tmux direttamente. Il contesto tmux e' gestito interamente a livello di codice, non nel prompt.

### Verify skill e tmux

Nello schema delle skill di verifica:
```
CLI tool → suggerisci verifier basato su Tmux
Tmux e' tipicamente installato a livello di sistema, verifica solo disponibilita'
verifier-cli allowed-tools: Tmux, Bash(asciinema:*), Read, Glob
```

---

## 11. Errori e Messaggi tmux

### Messaggi di errore

| Messaggio | Contesto |
|-----------|----------|
| `Error: --tmux is not supported on Windows` | Flag `--tmux` su Windows |
| `Error: --tmux requires --worktree` | Flag `--tmux` senza `--worktree` |
| `Error: tmux is not installed.` | tmux non trovato nel PATH |
| `Warning: Failed to create tmux session: ${error}` | Creazione sessione fallita |
| `SessionEnd hook [${command}] failed: ${output}` | Hook sessione fallito |
| `Failed to create tmux window: ...` | Creazione pane teammate fallita |
| `Failed to send command to tmux window: ...` | send-keys fallito |

### Messaggi informativi

| Messaggio | Contesto |
|-----------|----------|
| `Created tmux session: ${name}` | Sessione worktree creata |
| `To attach: tmux attach -t ${name}` | Istruzione per l'utente |
| `Tmux session ${name} is still running; reattach with: tmux attach -t ${name}` | Worktree exit con keep |
| `[TmuxBackend] Rebalanced ${count} teammate panes with leader` | Debug log |

### Istruzioni installazione (per messaggio utente)

```
macOS:
  brew install tmux
  tmux new-session -s claude

linux/wsl:
  sudo apt install tmux    # Ubuntu/Debian
  sudo dnf install tmux    # Fedora/RHEL
  tmux new-session -s claude

windows:
  Richiede WSL, poi dentro WSL:
    sudo apt install tmux
    tmux new-session -s claude
```

---

## 12. Implicazioni per Aegis

### Conferme positive

1. **Nessun conflitto architetturale**: CC non usa tmux per la propria sessione. L'approccio Aegis di wrappare CC in tmux e l'unico modo possibile per controllo a livello terminale.

2. **Socket isolation**: Se CC lancia swarm teammates, usa socket separati (`-L claude-swarm-{pid}`). Non conflittua con la sessione tmux di Aegis.

3. **Nessuna API tmux interna**: CC non espone tmux come tool — tutto plumbing interno.

4. **sendKeysVerified() e' un vantaggio**: CC fa fire-and-forget, Aegis verifica con capture-pane (fino a 3 retry). Aegis e' piu' robusto.

5. **Hook system compatibile**: Aegis puo' usare SessionStart/Stop/StopFailure hooks senza interferenze.

### Rischi da monitorare

6. **Colori ridotti**: Dentro tmux, CC cap i colori a 256. Se il terminal parser di Aegis dipende da codici truecolor per detectare stati, potrebbe fallire.

7. **Env var TMUX**: Aegis setta `$TMUX` per CC? CC rileva `$TMUX` e cambia comportamento (colori, clipboard, escape sequences). Da verificare.

8. **Prefix key conflicts**: Se il prefix tmux di Aegis confligge con i keybinding CC (C-b, C-c, C-d, ecc.), l'UX ne risente. CC mostra istruzioni speciali ma l'esperienza e' degradata.

9. **Escape sequence wrapping**: Le OSC 52 sequences per clipboard sono wrapped in `DCS tmux;...ST`. Se Aegis cattura e parsa l'output, deve gestire questo wrapping.

10. **Swarm tmux detection**: Se CC rileva `$TMUX` e pensa di essere dentro tmux, potrebbe tentare split-pane per teammates nella sessione Aegis invece di creare una sessione separata.

### Opportunita'

11. **Hook per session discovery**: Il campo `session_id` e `transcript_path` in SessionStart hook sono direttamente usabili dal dual discovery system di Aegis.

12. **Permission mode passthrough**: Aegis passa `--permission-mode` a CC. CC lo propaga ai teammate. Coerente con il permission guard di Aegis.

13. **Worktree awareness**: Se Aegis supporta worktree, il flag `--tmux` di CC crea sessioni tmux separate con naming prevedibile (`{repo}_{worktree}`).

### Tabella riassuntiva confronto Aegis vs CC

| Aspect | Aegis | Claude Code |
|--------|-------|-------------|
| `capture-pane` | Si (sendKeysVerified) | **No** (0 occorrenze) |
| `send-keys` | Si (con verifica) | Si (fire-and-forget, no verify) |
| Retry su tmux | 3 tentativi | 0 tentativi |
| Mutex tmux | No (direct calls) | Si (promise chain) |
| Debounce | No | 200ms post-layout |
| Socket isolation | Sessione "aegis" | `-L claude-swarm-{pid}` |
| tmux per sessione | Si (wrapping esterno) | **No** (Ink rendering) |
| tmux per swarm | N/A | Si (TmuxBackend) |
| tmux per worktree | N/A | Si (`--tmux --worktree`) |

---

## Appendice A: Mappa completa comandi tmux in CC

| Comando tmux | Contesto | Modalita' |
|-------------|----------|-----------|
| `tmux -V` | Check disponibilita' | Entrambi |
| `tmux show-options -g prefix` | Rileva prefix key | Worktree |
| `tmux has-session -t {name}` | Check esistenza | Entrambi |
| `tmux new-session -d -s {name} -n {win} -P -F "#{pane_id}"` | Crea sessione swarm | External |
| `tmux new-session -d -s {name} -c {path}` | Crea sessione worktree | Worktree |
| `tmux new-session -A -s {name} -c {path} -- {node} {args}` | Crea+attach worktree | Worktree |
| `tmux new-window -t {session} -n {name} -P -F "#{pane_id}"` | Crea finestra teammate | External |
| `tmux split-window -t {pane} -h -l 70% -P -F "#{pane_id}"` | Split pane | Split-pane |
| `tmux send-keys -t {target} {cmd} Enter` | Invia comando | Entrambi |
| `tmux kill-pane -t {target}` | Chiude pane | Entrambi |
| `tmux kill-session -t {name}` | Chiude sessione | Worktree |
| `tmux list-panes -t {target} -F "#{pane_id}"` | Lista pane | Entrambi |
| `tmux select-layout -t {target} main-vertical` | Layout con leader | Split-pane |
| `tmux select-layout -t {target} tiled` | Layout tiled | External |
| `tmux resize-pane -t {pane} -x 30%` | Ridimensiona leader | Split-pane |
| `tmux select-pane -t {target} -P bg=default,fg={color}` | Colore bordo | Entrambi |
| `tmux set-option -p -t {target} pane-border-style fg={color}` | Stile bordo | Entrambi |
| `tmux set-option -p -t {target} pane-active-border-style fg={color}` | Stile bordo attivo | Entrambi |
| `tmux select-pane -t {target} -T {title}` | Titolo pane | Entrambi |
| `tmux set-option -p -t {target} pane-border-format "..."` | Formato bordo | Entrambi |
| `tmux set-option -w -t {target} pane-border-status top` | Stato bordo | Entrambi |
| `tmux new-session -d -s claude-hidden` | Sessione nascosta | Hide/show |
| `tmux break-pane -d -s {target} -t claude-hidden:` | Nasconde pane | Hide/show |
| `tmux join-pane -h -s {target} -t {dest}` | Mostra pane | Hide/show |
| `tmux display-message -p "#{pane_id}"` | Ottiene pane corrente | Split-pane |
| `tmux display-message -p "#{session_name}:#{window_index}"` | Ottiene window target | Split-pane |
| `tmux switch-client -t {name}` | Switch sessione | Worktree |
| `tmux load-buffer -w -` | Clipboard | Dentro tmux |
| `tmux -CC attach-session -t {name}` | iTerm2 attach | Worktree |

---

_Report generato dallo swarm di analisi Hephaestus, 2026-03-24_

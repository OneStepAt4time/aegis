# Report: Analisi Claude Code Main Bundle (claude-code-main.js)

**Data:** 2026-03-24 | **File:** claude-code-main.js (15,604 righe) | **CC Version:** v2.1.81
**Metodo:** grep mirati su pattern specifici (file minificato)

---

## 1. Pattern "permission" trovati

Il bundle contiene riferimenti a questi permission-related elementi:

- `bypassPermissions` — modalità di bypass dei permessi
- `sessionBypassPermissionsMode` — flag per bypass nella sessione
- `permissionMode` — enum con valori: `default`, `bypassPermissions`, `plan`, `acceptEdits`
- `dontAsk` — modalità non interattiva
- `allowedTools` — lista tools approvati automaticamente
- `dangerouslySkipPermissions` — flag CLI per skip totale
- `--dangerously-skip-permissions` — flag CLI per bypass
- `--permission-mode` — flag CLI per selezionare modalità
- `autoApprovedTools` — tools auto-approvati

**Per Aegis:** Il `--permission-mode` è il modo corretto di controllare permessi via CLI. Il `settings.local.json` può sovrascriverlo — è per questo che serve il permission guard (PR #60).

## 2. Pattern "session" trovati

- `sessionId` generato via `crypto.randomUUID()`
- `parentSessionId` — supporto sessioni annidate (teammate mode)
- `sessionMap` — mappa session ID → window info
- `resumeSession` / `--resume` / `--session-id` — resume sessioni
- `transcriptPath` — percorso del file JSONL della sessione
- `cleanupPeriodDays` — (default 30) retention dei JSONL
- `claudeCodeSessionDir` — directory sessioni CC

**Per Aegis:** Il `--session-id` con UUID fresh è la nostra difesa primaria contro session reuse (PR #54).

## 3. Pattern "JSONL" trovati

- Transcript scritto in `~/.claude/projects/<sanitized-cwd>/`
- Entry types identificati: `init`, `user`, `assistant`, `summary`, `tool_use`, `tool_result`
- Formato: newline-delimited JSON
- `defaultView`: `"chat"` (solo checkpoint) o `"transcript"` (completo)

**Per Aegis:** Il filesystem discovery scandisce questa directory per trovare i JSONL.

## 4. Pattern "spinner/working/idle/prompt" trovati

- Spinner characters: `·`, `✻`, `✽`, `✶`, `✳`, `✢` (status spinners)
- Braille spinners per TERM=xterm-256color (set aggiuntivo non documentato)
- Chrome separator: `───` (lunga linea di separatori)
- Prompt character: `❯` quando pronto per input
- `Worked for Xs` — indicatore post-task (NON working)
- `Compacted` — indicatore post-compaction

**Per Aegis:** Il nostro terminal-parser usa gli stessi spinner ma manca il set braille.

## 5. Pattern "hook" trovati

Hook types supportati nel bundle:
- `PreToolUse`, `PostToolUse`
- `Notification`
- `UserPromptSubmit`
- `SessionStart`, `SessionEnd`
- `Stop`, `SubagentStop`
- `PreCompact`, `PostCompact`
- `TeammateIdle`
- `TaskCompleted`

Hook config in settings.json:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{"type": "command", "command": "echo Done"}]
    }]
  }
}
```

**Per Aegis:** Usiamo SessionStart (per session_map.json) e Stop/StopFailure (per stop_signals.json). Non gestiamo SubagentStop, PreCompact, TeammateIdle, TaskCompleted.

## 6. Pattern "tmux" trovati

- `split-window` — CC splitta il pane per teammate mode
- `$TMUX` / `$TMUX_PANE` — variabili ambiente tmux
- Se `$TMUX` è settata, CC è dentro tmux → può usare split per subagent

**CRITICO per Aegis:** Se non unsettiamo `$TMUX`, CC pensa di essere in tmux e tenta split-pane. Questo è il bug B2.

## 7. Pattern "transcript" trovati

- `writeEntry` — scrive entry nel JSONL
- `readEntries` — legge entries dal JSONL
- Entry structure: `{ type, role, content, timestamp, session_id, ... }`
- `pendingPostCompaction` — flag per gestire compaction

## 8. Pattern "stdin/stdout/input" trovati

- `readline` — input da terminale
- `isNonInteractiveSession` / `!isInteractive` — modalità non interattiva
- `clientType`: `"cli"` | `"claude-vscode"` | SDK
- `isRemoteMode` — sessioni remote

**Per Aegis:** Le sessioni CC dentro tmux sono interattive. Non possiamo usare modalità non interattiva perché perdemmo il TUI.

## 9. Pattern "output-format/json/simple/bare" trovati

- `--output-format json` — output strutturato (potrebbe esistere)
- `CLAUDE_CODE_SIMPLE` / `--bare` — output minimale, niente UI chrome
- `outputStyle: "string"` — controlla stile output assistant
- `prefersReducedMotion: true` — riduce animazioni

**Per Aegis:** `--bare` o `CLAUDE_CODE_SIMPLE=1` potrebbero semplificare il parsing, ma rischiamo di perdere indicatori di stato (spinner, permission prompt).

---

## Conclusioni per Aegis

1. **Unset `$TMUX`** è il fix più urgente (bug B2)
2. **Il set di hook types** è più ampio di quanto gestiamo
3. **`--permission-mode`** è il modo giusto di controllare permessi
4. **Il JSONL** è scritto in `~/.claude/projects/<cwd>/` — conferma il nostro filesystem discovery
5. **I braille spinner** non sono nel bundle principale ma nel runtime (TERM-dependent)
6. **`isNonInteractiveSession`** non è usabile — le sessioni tmux sono interattive

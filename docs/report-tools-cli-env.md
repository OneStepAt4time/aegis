# Report: Tool System, CLI e Variabili d'Ambiente di Claude Code

**Data:** 2026-03-24 | **Fonti:** tool-schemas-main.txt, tool-definitions-full.txt, tool-descriptions.txt, tool-impl-section.txt, bash-completion.sh, system-prompt-env.txt

---

## 1. Tool Disponibili in Claude Code

### Tool Core (built-in)

| Tool | Nome Interno | Schema Input | Schema Output |
|------|-------------|-------------|---------------|
| **Bash** | `Bash` (CD) | `command`, `description`, `timeout`, `run_in_background`, `dangerouslyDisableSandbox` | `stdout`, `stderr`, `interrupted`, `backgroundTaskId`, `isImage`, `persistedOutputPath` |
| **Read** | `Read` (L8) | `file_path`, `offset`, `limit` | `content` (testo o immagine base64) |
| **Edit** | `Edit` (y8) | `file_path`, `old_string`, `new_string` | Conferma successo/fallimento |
| **Write** | `Write` (Z9) | `file_path`, `content` | Conferma |
| **NotebookEdit** | `NotebookEdit` (Qj) | `file_path`, `new_cell_types`, `cells` | Conferma |
| **WebFetch** | `WebFetch` (CP) | `url`, `prompt` | Markdown convertito |
| **WebSearch** | `WebSearch` (sE) | `query` | Risultati con Sources |

### Tool di Ricerca (derivati da Bash, con compressione dedicata)

- `grep`, `rg`, `egrep`, `fgrep` → compressione tipo grep
- `find` → compressione tipo find
- `cat`, `head`, `tail` → compressione tipo file-read
- `git status/diff/log/show/branch` → compressione git
- `npm/yarn/pnpm test/install` → compressione test runner
- `cargo test/build/clippy`, `go test/build/vet`
- `pytest`, `vitest`, `jest`, `playwright`
- `tsc`, `eslint`, `mypy`, `golangci-lint`, `ruff`, `biome`
- `docker logs/ps`, `kubectl logs`
- `gh pr diff/checks/run`

### Agent Built-in

| Agent | Model | Permission | Tools | Scopo |
|-------|-------|------------|-------|-------|
| **general-purpose** | default | default | tutti (`["*"]`) | Ricerca codice, task multi-step |
| **statusline-setup** | sonnet | default | Read+Edit | Configura statusLine |
| **Plan** | default | default | READ-ONLY (esclude Bash, Edit, Write, NotebookEdit, WebFetch) | Architetto software |
| **claude-code-guide** | haiku | dontAsk | WebFetch+WebSearch | Guida CC, Agent SDK, API |
| **Verification** | default | default | tutti | Verifica adversariale (PASS/FAIL/PARTIAL) |

### Compressione Output Intelligente

CC implementa `maybeCompressOutput()` che riconosce e comprime:
- Output JSON (rimozione chiavi boilerplate GitHub API)
- Dedup linee duplicate
- Truncamento con "↑ N duplicate lines" indicator
- Threshold configurabile per dimensione output

---

## 2. Flag CLI di Claude Code

**NOTA:** `bash-completion.sh` contiene completion per **bun** (runtime JS), NON per Claude Code.

Flag CC ricavati dal sorgente:

| Flag | Scopo |
|------|-------|
| `--dangerously-skip-permissions` | Bypass totale permessi |
| `--permission-mode <mode>` | `default`, `bypassPermissions`, `plan`, `acceptEdits` |
| `--model <model>` | Seleziona modello |
| `--session-id <id>` | Resume sessione specifica |
| `--resume` | Resume ultima sessione |
| `--bare` / `CLAUDE_CODE_SIMPLE=1` | Output minimale |
| `--agent <name>` | Avvia con agente specifico |
| `--worktree` | Sessione worktree git isolata |
| `--output-format json` | Output strutturato (potrebbe esistere) |
| `--continue` | Continua sessione |

---

## 3. Variabili d'Ambiente

### Fondamentali per Aegis

| Variabile | Scopo | Per Aegis |
|-----------|-------|-----------|
| `ANTHROPIC_API_KEY` | API key Anthropic | Necessaria |
| `CLAUDE_CODE_USE_BEDROCK` | Usa Bedrock | Provider alternativo |
| `CLAUDE_CODE_USE_VERTEX` | Usa Vertex AI | Provider alternativo |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Zero telemetria | **Settare per sessioni Aegis** |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | Disabilita task background | Per debug/testing |
| `CLAUDE_CODE_SIMPLE` | Output minimale | ⚠️ Perde indicatori stato |
| `DISABLE_TELEMETRY` | Disabilita telemetria | Alternativa |
| `MAX_THINKING_TOKENS` | Limite thinking | Per controllare costi |
| `CLAUDE_CODE_EFFORT_LEVEL` | `low/medium/high/max/auto` | Controlla qualità |
| `SHELL` | Shell utente | Context |
| `TERM` | Tipo terminale | Determina braille spinner |
| `TMUX` / `TMUX_PANE` | **Unset prima di lanciare CC!** | **Bug B2** |

### Enterprise/SDK

| Variabile | Scopo |
|-----------|-------|
| `CLAUDE_CODE_ENTRYPOINT` | `sdk-ts`, `sdk-py`, `sdk-cli` |
| `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS` | Disabilita agent built-in |
| `CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR` | Indicatore sandbox |
| `CLAUDE_CODE_GLOB_TIMEOUT_SECONDS` | Timeout glob/rg |
| `NODE_EXTRA_CA_CERTS` | CA per proxy TLS |
| `ANTHROPIC_LOG` | `debug` per log dettagliati |

### Feature Flags (server-side, GrowthBook)

Flag rilevanti non direttamente controllabili:
- `tengu_tight_weave` — output conciso subagent
- `tengu_turtle_carbon` — default effort
- `tengu_marble_anvil` — clear thinking
- `tengu_sepia_heron` — token saver
- `tengu_fast_mode` — fast mode
- `tengu_plan_mode_interview_phase` — interview in plan mode

---

## 4. Hook System

### Hook Types Completi

```
PreToolUse, PostToolUse, Notification, UserPromptSubmit,
SessionStart, SessionEnd, Stop, SubagentStop,
PreCompact, PostCompact, TeammateIdle, TaskCompleted
```

### Hook Config

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

- Matcher: pipe-separated tool names, `""` per tutti, `"MCP server 'name'"` per MCP
- Types: `command`, HTTP hooks (con URL allowlist)
- `disableAllHooks` / `allowManagedHooksOnly` per enterprise
- Tracking: `turnHookDurationMs`, `turnHookCount`

---

## 5. Impatto su Aegis

### Fondamentale
1. **Unset `$TMUX` + `$TMUX_PANE`** — bug B2, priorità assoluta
2. **`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`** — zero telemetria
3. **`--permission-mode`** — modo corretto di controllare permessi
4. **`--session-id` con UUID fresh** — difesa session reuse
5. **Compressione output** — Aegis potrebbe implementare sistema simile per relay
6. **StatusLine JSON** — monitoring reale (context_window %, rate_limits)
7. **Bash `run_in_background`** — fondamentale per multi-session orchestration

### Utile ma Secondario
8. **Plugin system** — distribuire "aegis-tools" come plugin CC
9. **MCP integration** — Aegis come MCP server per CC
10. **Verification agent** — integrare nel CI/CD
11. **`MAX_THINKING_TOKENS`** — controllare costi thinking

### Non Rilevante
12. **Bun completions** — runtime JS, non CC
13. **Feature flags server-side** — non forzabili

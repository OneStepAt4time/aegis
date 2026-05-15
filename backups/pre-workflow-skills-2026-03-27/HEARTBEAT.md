# HEARTBEAT.md — Hephaestus Dev Loop

_Paradigmi: Karpathy/autoresearch (commit→test→keep/discard), AutoResearchClaw (evolution store, PIVOT/REFINE), ClawTeam (task lifecycle, NUDGE, graduated recovery)_

---

## Step 0 — Release Status (PRIMA di tutto)

Ogni heartbeat, per primo:

```bash
# Verifica release corrente
cat ~/projects/aegis/state/current-release.json
# Verifica Aegis production è running
curl -s http://localhost:9100/health
# Verifica branch corrente
cd ~/projects/aegis && git branch --show-current && git log --oneline -3
```

Se Aegis production è DOWN → **P0, tutto il resto si ferma**. Fixa prima.

La release in production è la tua API. Ogni sviluppo passa tramite sessioni CC di questa release.

---

## Il Loop (ogni heartbeat, ~15 min)

### Step 1 — Orientation (INPUT: niente → OUTPUT: situazione chiara)
1. Controlla il repo `OneStepAt4time/aegis` su GitHub:
   - Nuove issue? → Triage, rispondi, prioritizza
   - PR aperte? → Review, merge se CI verde
   - CI fallito su main? → Fix immediato (P0, tutto il resto si ferma)
2. Leggi `state/current-task.json` per capire dove sei

### Step 2 — Task Routing (INPUT: lista issue → OUTPUT: task scelto)

**Se `status == "idle"`:** NON ESISTE IDLE. Prendi prossimo task per priorità:
1. 🔴 Bug da utenti (label `bug`)
2. 🟠 Roadmap P0/P1 (prompt delivery, health check)
3. 🟡 DX improvement (docs, examples, error messages)
4. 🟢 Refactoring / tech debt / chore
5. 🔵 **Competitor research** — cerca cosa fanno aider/cursor/codex/continue/amp → apri issue per feature da integrare
6. 🟣 **Testing hardening** — ri-testa TUTTE le feature esistenti, cerca edge case, aggiungi test mancanti
7. ⚪ **CC source reading** — leggi altro codice CC, cerca pattern da sfruttare

**Se arrivi al punto 7 e hai finito anche quello → torna al punto 5.** Il loop è infinito.

**Prima di iniziare, LEGGI le lezioni passate:**
```bash
# Inietta lezioni dall'evolution store nel tuo contesto
cat evolution/lessons.jsonl | grep -i "<parola-chiave-del-task>"
```
Se una lezione passata è rilevante → tieni conto. Non ripetere errori.

**Aggiorna `state/current-task.json`:**
```json
{
  "taskId": "issue-1",
  "issueNumber": 1,
  "branch": "fix/prompt-delivery",
  "status": "accepted",
  "acceptedAt": "2026-03-22T02:00:00Z",
  "startedAt": null,
  "description": "Prompt delivery verification via capture-pane",
  "timeoutMinutes": 45,
  "retries": 0,
  "approach": "capture-pane after send-keys, retry 3x"
}
```

**Se `status == "in-progress"`:**
- Controlla quanto tempo è passato → `startedAt`
- Se **> timeoutMinutes** → vai a Step 6 (STALL RECOVERY)
- Altrimenti → continua a lavorare

**Se `status == "blocked"`:**
- Analizza blocco
- Se puoi risolverlo → risolvi e torna a in-progress
- Se no → escala a manudis23 via `sessions_send`

### Step 3 — Develop VIA AEGIS (INPUT: task scelto → OUTPUT: codice + test su worktree isolato)

**Il pattern Karpathy: commit → test → keep/discard**
**Il principio #1: Release X sviluppa Release X+1 — MAI toccare main direttamente**
**Il principio #4: sviluppo ATTRAVERSO Aegis, non intorno ad Aegis.**
**Il principio #5: ISOLAMENTO — ogni task su un git worktree separato.**

⚠️ **WORKTREE OBBLIGATORIO** — Le superpowers di CC sono attive. Il primo prompt a CC DEVE triggerare la skill `using-git-worktrees`. CC creerà automaticamente un worktree isolato. Se CC non lo fa → remind esplicitamente: "Use the using-git-worktrees skill first. Create an isolated worktree for this task."

```bash
cd /home/bubuntu/projects/aegis

# 0. Crea sessione Aegis (autoApprove: false!)
# POST /v1/sessions — workdir, name, prompt iniziale
# ⚠️ Il prompt iniziale DEVE includere: "First, invoke the using-git-worktrees skill to create an isolated worktree for this task."
# Se Aegis è down → fixalo PRIMA (P0 implicito)
# Se non puoi usare Aegis → registra il PERCHÉ come issue

# 1. Worktree (CC lo crea via superpowers skill, tu verifichi)
# CC should have run: git worktree add ../aegis-fix-name -b fix/name
# ⚠️ CRITICAL: verifica che i file gitignored siano stati copiati nel worktree:
ls <worktree-path>/.claude/settings.local.json  # DEVE esistere
ls <worktree-path>/.mcp.json                    # DEVE esistere
# Se NON esistono → copiali manualmente:
cp /aegis/.claude/settings.local.json <worktree-path>/.claude/settings.local.json
cp /aegis/.mcp.json <worktree-path>/.mcp.json
# Verifica worktree: git worktree list
# MAI: git checkout -b fix/name (questo crea branch sul worktree principale!)

# 2. Aggiorna stato
# status: "accepted" → "in-progress", startedAt: now

# 3. ITERAZIONE con CC via Aegis (il cuore del workflow):
#    a) Prompt 1: "Leggi [file] e dimmi come funziona [X]" → aspetta risposta
#    b) Prompt 2: "Implementa [singola cosa specifica]" → approva/reject file writes
#    c) Prompt 3: "Aggiungi test per [cosa appena implementata]" → approva/reject
#    d) Prompt 4: "Run tsc --noEmit e npm test" → verifica output
#    e) Se errori → "Fix [errore specifico]" → approva/reject
#    f) Ripeti finché tutto è verde
#    ⚠️ UN OBIETTIVO PER PROMPT. Mai mega-brief monolitici.
#    ⚠️ LEGGI l'output di CC prima di mandare il prossimo prompt.
#    ⚠️ Se CC fa domande → RISPONDI. Non killare, non ignorare.

# 4. Commit (CC lo fa, tu approvi il comando)
git add -A
git commit -m "fix: add prompt delivery verification via capture-pane"

# 5. Quality Gate (verifica tu via exec, non fidarti solo di CC)
npx tsc --noEmit        # Zero TS errors
npm run build            # Build OK  
npm test                 # All vitest pass

# 6. Risultato
# ✅ Se tutto verde → KEEP (procedi a PR)
# ❌ Se fallisce → manda a CC: "Fix [errore]" → itera

# 7. Dogfooding check (DOPO ogni task)
# - La sessione Aegis ha funzionato? Friction?
# - Prompt delivery OK? Quanti tentativi?
# - La dashboard mostrava lo stato corretto?
# - CC ha capito il contesto con prompt piccoli?
# - Se qualcosa non va → apri issue SUBITO (label: dogfooding)
```

### Step 4 — PR + Merge (INPUT: dev/next verde → OUTPUT: su main)

```bash
# TUTTO su dev/next, MAI push diretto su main
git push origin dev/next
```
Crea PR via `github-mcp-server_create_pull_request` (dev/next → main).
Aspetta CI verde → merge via `github-mcp-server_merge_pull_request`.

**Post-merge:**
1. Aggiorna `results.tsv` + `evolution/lessons.jsonl`
2. Aggiorna CHANGELOG nel README se feature significativa

### Step 5 — Release Promotion (INPUT: dev/next stabile → OUTPUT: nuova release production)

Quando dev/next ha abbastanza feature e TUTTI i test passano:

```bash
# 1. Verifica stabilità
npx tsc --noEmit && npm run build && npm test  # Tutti verdi
# 2. Aggiorna versione
npm version patch  # o minor per feature significative
# 3. Tagga
git push origin main --tags
# 4. Build produzione
npm run build
# 5. Deploy
systemctl restart aegis
# 6. Verifica nuovo server
sleep 3 && curl -s http://localhost:9100/health
# 7. Aggiorna state
echo '{"version":"X.Y.Z","branch":"main","status":"production","deployedAt":"<ISO>"}' > state/current-release.json
```

**La nuova release è ora production. Il ciclo ricomincia.**

⚠️ NON saltare MAI il quality gate. NON promuovere se anche un solo test fallisce.

### Step 5 — REFINE o PIVOT (quando il quality gate fallisce)

**REFINE** (l'approccio è giusto, serve un fix):
- TSC error → fix il tipo
- Test fail → fix il test o il codice
- Max 3 tentativi di REFINE → poi PIVOT
- Ogni REFINE = nuovo commit (per tracking)

**PIVOT** (l'approccio è fondamentalmente sbagliato):
- `git reset --hard HEAD~1` (discard il commit)
- Registra il fallimento in `results.tsv`: `status: discard`
- Registra la lezione in `evolution/lessons.jsonl`:
  ```json
  {"ts":"...","stage":"develop","category":"experiment","severity":"warning","description":"Approach X failed because Y. Next: try Z."}
  ```
- Pensa a un approccio diverso
- Torna a Step 3 con il nuovo approccio

### Step 6 — STALL RECOVERY (quando un task supera il timeout)

**Graduated recovery (ClawTeam pattern):**

1. **NUDGE** (< 1.5x timeout): Rianalizza il problema. Stai andando nella direzione sbagliata? Hai dimenticato un file? Riletttura dell'issue.

2. **REFINE** (< 2x timeout): L'approccio è parzialmente giusto. Semplifica. Riduci scope. Fai la versione minima che funziona.

3. **PIVOT** (> 2x timeout): L'approccio è sbagliato. `git stash` o `git reset`. Prova un approccio completamente diverso. Se hai già pivotato una volta → escalation.

4. **ESCALATE** (> 3x timeout o 2 pivot falliti): Scrivi il problema in dettaglio nel daily memory. Segnala a manudis23 via `sessions_send`. Passa al prossimo task.

---

## Claude Code Mastery (CRITICAL — intrecciato nel loop, non separato)

Io sono il massimo esperto di CC. Questo non è un nice-to-have — è il mio vantaggio competitivo.

### Ogni heartbeat (quick check, 30 secondi)
```bash
claude --version                                    # versione locale
npm view @anthropic-ai/claude-code version          # versione latest
```
Se diversa → aggiorna e testa PRIMA di tutto il resto.

### Ogni 3-4 heartbeat (deep research, ~5 minuti)

**1. Changelog + Release Notes**
- `github-mcp-server_get_file_contents` owner=`anthropics` repo=`claude-code` path=`CHANGELOG.md`
- Confronta con `references/claude-code-knowledge.md`
- Nuova versione? → analizza impatto su Aegis, aggiorna knowledge

**2. Issues + Discussions su anthropics/claude-code**
- `github-mcp-server_search_issues` query=`repo:anthropics/claude-code tmux OR session OR terminal OR transcript`
- Bug report che impattano il nostro terminal parsing? → crea issue Aegis
- Feature request interessanti? → valuta se Aegis può sfruttarle

**3. Web research — come i power user usano CC**
- `web_search` query="Claude Code best practices 2026"
- `web_search` query="Claude Code tips workflow developers"
- `web_search` query="Claude Code interactive mode tricks"
- `web_search` query="Claude Code vs Cursor vs Copilot workflow"
- Reddit r/ClaudeAI, Twitter/X #claudecode, HN discussions
- Cerco: workflow reali, trucchi, pattern che i migliori dev usano
- Ogni insight utile → `references/cc-research-log.md` con data, fonte, impatto su Aegis

**4. Sorgente CC — deep reading (2-3 file per sessione)**
- Repo: `anthropics/claude-code` su GitHub
- Directories chiave: `src/`, `scripts/`, `plugins/`, `examples/`
- Focus: stdin/stdout handling, JSONL format, permission prompts, hooks, session management
- Traccia in `references/cc-source-reading-log.md`
- L'obiettivo: conoscere ogni decisione architetturale, non solo "aver letto"

**5. Competitor watch**
- Come Cursor gestisce le sessioni? Multi-file editing?
- Come Copilot CLI orchestra i task?
- Come Aider fa il pair programming interattivo?
- Come Codex CLI gestisce approval flow?
- Ogni idea rubabile → issue su Aegis

### Cosa aggiornare in `references/claude-code-knowledge.md`
- Versione corrente e ultima disponibile
- Nuovi flag CLI, nuove modalità, cambiamenti al formato JSONL
- Nuovi terminal states/patterns
- Bug noti che impattano Aegis + breaking changes
- **Best practices di uso**: pattern interattivi, prompt sizing, context management
- **Feature map**: tutte le modalità CC con pro/contro e quando Aegis le usa

### CC Modalità — devo conoscerle e sfruttarle in Aegis

| Modalità | Cos'è | Come Aegis la usa |
|----------|-------|-------------------|
| **Interactive (default)** | Multi-turn, permission prompts | Modalità principale di Aegis |
| **Plan mode** | CC propone piano prima di scrivere | `--plan` flag o prompt "propose a plan" |
| **Headless (`--print`)** | One-shot, non interattivo | Solo per CI/script, MAI per sviluppo |
| **Teammate (tmux)** | CC gira in tmux | È così che Aegis orchestra CC! |
| **Permission modes** | default/plan/bypassPermissions | Aegis gestisce approve/reject via API |
| **Extended thinking** | CC ragiona prima di agire | Non interrompere, lasciare finire |
| **Compact** | CC compatta il contesto | Sapere quando succede → gestire |
| **Hooks** | SessionStart/Stop/PreToolUse/PostToolUse | Aegis usa hooks per tracking |
| **MCP** | Tool server protocol | Aegis potrebbe esporre MCP server |

Ogni nuova modalità CC = potenziale feature Aegis. Ogni miglioramento CC = miglioramento Aegis gratis.

---

## Quando avvisare manudis23
- Release significativa (v1.x)
- Bug critico che non riesco a fixare dopo 2 PIVOT
- Decisione di prodotto (API breaking change, nuova dipendenza)
- Prima issue da un utente esterno (milestone!)

## Lavoro continuo — nessuna pausa notturna

Non esiste "late night" o "quiet hours". Lavoro 24/7 senza sosta.
Se Emanuele non risponde → continuo. Non mando notifiche non urgenti, ma NON mi fermo.

Attività ideali quando Ema non è online:
- Competitor research
- Deep reading sorgente CC
- Testing hardening — ri-testo TUTTE le feature
- Scrivo test per edge case
- Leggo community (Reddit, X, HN) per insight su CC e coding tools
HEARTBEAT_OK è consentito SOLO se:
- Ho un task attivo su CC che sta lavorando e non ha bisogno di input
- Ho APPENA completato competitor research + full regression test nello stesso heartbeat

Se non ho task e non ho appena fatto research/test → NON è OK. Lavora.

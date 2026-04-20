# VIBE_CODER_BIBLE — Team Shared Knowledge Base

## Table of Contents

- [Cos'è il Vibe Coding](#cosè-il-vibe-coding)
- [Scelta degli Strumenti](#scelta-degli-strumenti)
- [Gestione del Contesto AI](#gestione-del-contesto-ai)
- [Organizzazione del Codice](#organizzazione-del-codice)
- [Sicurezza](#sicurezza)
- [Pianificazione e Prompt](#pianificazione-e-prompt)
- [Strategie di Debugging](#strategie-di-debugging)
- [AEGIS Usage Best Practices — Hephaestus](#aegis-usage-best-practices-hephaestus)
- [Quality Gates — All Team](#quality-gates-all-team)
- [Team Learning Points](#team-learning-points)

---

# Vibe Coding Guide
> Best Practices & Tips per la programmazione assistita dall'AI

## Cos'è il Vibe Coding

Un approccio di programmazione assistita dall'AI in cui gli sviluppatori descrivono ciò che vogliono in linguaggio naturale, e gli strumenti AI generano il codice. Velocità incontra creatività, ma con considerazioni importanti.

### Vantaggi

- Prototipazione rapida e sviluppo di MVP
- Accessibile anche ai non-programmatori
- Maggiore creatività e flow state
- Automazione di attività ripetitive

### Svantaggi

- Vulnerabilità di sicurezza
- Accumulo di debito tecnico
- Difficoltà nel debugging
- Problemi di scalabilità

> *Vibe coding: dove l'AI incontra la creatività umana. Usare responsabilmente.*

## Scelta degli Strumenti

La scelta dello strumento giusto dipende dal tipo di progetto. Diversi modelli AI hanno punti di forza diversi: abbina lo strumento al tuo task.

### Sviluppo Web

| Strumento | Caratteristiche |
|-----------|-----------------|
| **Claude** | Ottimo per React, HTML/CSS, JavaScript |
| **Replit AI** | Cloud-based, deployment istantaneo |

### Sviluppo Python

| Strumento | Caratteristiche |
|-----------|-----------------|
| **OpenAI GPT-4.1** | Eccellente per data science e ML |
| **OpenAI o3** | Capacità di ragionamento avanzato |

## Gestione del Contesto AI

Il contesto AI è come la memoria a breve termine: mantienilo focalizzato e fresco.

### Regole Principali

1. **Avvia nuove chat spesso** 
   Il contesto si degrada con la lunghezza della sequenza. Copia e incolla il codice in chat fresche regolarmente.

2. **Usa i Projects** 
   Tieni traccia di ogni file in progetti organizzati per mantenere la struttura.

3. **Limite di 2500 righe** 
   La dimensione massima del file è ~2500 righe. Oltre questa soglia non rientrerà nella finestra di risposta.

4. **Solo il contesto rilevante** 
   Non serve l'intera app nel contesto — solo le parti rilevanti per il task corrente.

## Organizzazione del Codice

### Struttura dei File

- ✅ Suddividi i file grandi in sottocomponenti
- ✅ Commenta la struttura delle directory in cima ai file
- ✅ Chiedi la struttura delle cartelle fin dall'inizio
- ✅ Separa chiaramente frontend e backend

### Qualità del Codice

- ✅ Richiedi commenti che spiegano le funzioni
- ✅ Documenta chiaramente input e output
- ✅ Usa il version control in modo sistematico
- ✅ Estrai componenti riutilizzabili

### Esempio: Commento di struttura directory

```javascript
// Esempio: commento di struttura directory
// src/components/Dashboard/MetricsCard.jsx
// Parte della vista principale del dashboard
```

## Sicurezza

> ⚠️ L'AI non implementa sempre la sicurezza di default. Devi richiederla esplicitamente.

### Regole Critiche

- **Mai** eseguire il deploy con il tag `"Allow Browser Dangerously"`
- Chiedi codice sicuro **nel primo prompt**
- Richiedi esplicitamente la validazione degli input
- Sposta la logica sensibile nel backend

### Checklist di Sicurezza

- ☐ Autenticazione implementata
- ☐ Validazione degli input su tutti i form
- ☐ Gestione degli errori presente
- ☐ Dati sensibili cifrati
- ☐ API key nelle variabili d'ambiente

## Pianificazione e Prompt

### Elementi Essenziali del Prompt Iniziale

1. Definisci chiaramente input e output
2. Specifica tutte le pagine e le loro funzioni
3. Fai uno schizzo/wireframe del layout
4. Indica le preferenze tecnologiche
5. Richiedi codice sicuro e commentato

> **Tip:** Anche semplici schizzi su carta aiutano l'AI a capire la tua visione.

### Consigli di Comunicazione

- Impara i termini comuni dello sviluppo web (puoi usare ChatGPT con screenshot)
- Sii specifico sulle funzionalità, non solo sull'aspetto
- Fornisci esempi di applicazioni simili
- Chiarisci il flusso utente e le interazioni

## Strategie di Debugging

### Consiglio Specifico per Claude

Troppi edit a un artifact introducono errori. Chiedi a Claude di **riscrivere il codice da zero in un nuovo artifact** per correggere i bug accumulati.

### Richiedi le Modifiche in Formato Diff

Chiedi all'AI di mostrare le modifiche al codice in struttura diff. Questo ti aiuta a capire esattamente cosa sta cambiando e perché.

````
Esempio di prompt:
"Show me the changes in diff format, and explain what's old code did vs what's new code does"
```

**Vantaggi del formato diff:**

- ✓ Vedi esattamente quali righe stanno cambiando
- ✓ Capisci la funzionalità prima/dopo
- ✓ Individui effetti collaterali indesiderati

### Workflow di Debugging

1. **Testa a pezzi** — Esegui e verifica piccole sezioni di codice
2. **Aggiungi log** — Traccia il flusso di esecuzione e gli stati delle variabili
3. **Sii esplicito sugli errori** — Di' all'AI esattamente cosa c'è di sbagliato e il comportamento atteso
4. **Controlla le regressioni** — Le nuove funzionalità possono rompere quelle esistenti

> **Pro Tip:** Mantieni sempre una versione funzionante salvata prima di apportare modifiche importanti. Il version control è la tua rete di sicurezza.

---

*Vibe coding: dove l'AI incontra la creatività umana. Usare responsabilmente.*

---

## AEGIS Usage Best Practices — Hephaestus

### Before Starting Work

1. **Verify AEGIS auth token is present:**
   ```bash
   cat ~/.aegis-bridge/config.json | jq .authToken
   ```

2. **Verify git repository access:**
   ```bash
   cd ~/projects/aegis && git status
   ```

3. **Verify workdir exists:**
   ```bash
   ls -la ~/projects/aegis
   ```

4. **Verify path is typed correctly (character by character):**
   - Check path character by character before declaring infrastructure issue
   - Use `ls -la /path/typed` to verify path exists
   - Copy-paste if needed to avoid typing errors

### During Development

1. **Use subagent for implementation (not AEGIS sessions):**
   - Spawn subagent with explicit task description
   - Include issue URL in prompt
   - Monitor progress actively
   - Nudge if stall > 5 minutes

2. **Review changes before declaring complete:**
   - Read code changes via `git diff`
   - Verify they address the issue
   - Check for scope contamination

### After Subagent Completion

1. **Verify files exist:**
   ```bash
   ls -la ~/projects/aegis/src/[file].ts
   ```

2. **Verify git status:**
   ```bash
   git status
   ```
   Should show modified files, not "not a git repository"

3. **Verify changes are correct:**
   ```bash
   git diff
   ```

4. **Run UAT (User Acceptance Testing):**
   - Manually test feature if possible
   - Test via curl for API endpoints
   - Test UI in browser if applicable
   - Verify end-to-end flow works

5. **Run quality gate:**
   ```bash
   tsc --noEmit && npm run build && npm test
   ```

6. **Commit changes:**
   ```bash
   git add -A && git commit -m "feat: description"  # or fix:, refactor:, etc.
   ```

### Before Creating PR

1. **Verify all tests pass:** Not just subagent claim — actually run tests
2. **Verify build succeeds:** `npm run build` completes without errors
3. **Verify feature works manually (UAT):** Manual testing completed
4. **Verify PR targets correct branch:** `develop` (NOT `main`)
5. **Verify PR body includes:**
   - Issue URL: `https://github.com/OneStepAt4time/aegis/issues/N`
   - AEGIS version: `curl -s http://127.0.0.1:9100/v1/health | jq .version`
6. **Verify commits follow convention:**
   - `feat:` — Only for user-visible new features (NEVER for internal changes)
   - `fix:` — Bug fix
   - `refactor:` — Restructure without behavior change
   - `perf:` — Performance improvement
   - `chore:` — Build, CI, tooling
   - `test:` — Test
   - `docs:` — Documentation

7. **Only then:** Create PR and assign to Argus

### Critical Learnings

1. **Path Typing Error (4+ hours blocked):**
   - Error: `/home/buntu/` vs `/home/bubuntu/` (missing "u")
   - Occurrences: 15+ times
   - Root cause: Human error — didn't verify path with `ls`
   - Lesson: Verify path character-by-character before declaring infrastructure issue

2. **Subagent Verification Gap:**
   - Problem: Subagents reported "completed successfully" but changes not in git
   - Root cause: Did not verify with `git status` after completion
   - Lesson: Always verify `git status` and `git diff` after subagent completion

3. **Quality Control Gap:**
   - Problem: Did not verify code actually works beyond tests
   - Root cause: No UAT performed
   - Lesson: Manual testing (curl/UI) is mandatory beyond automated tests

4. **Stall Detection Gap (CC Cogitated Mode):**
   - Problem: CC entered "Cogitated for Xm Ys" status, stall detection didn't trigger
   - Root cause: `stallThresholdMs` only checks `lastActivity`, not `statusText`
   - Fix: Implemented in PR #1329 — `parseCogitatedDuration()`, `lastStatusText` Map, 5x stall threshold
   - Lesson: Stall detection must handle ALL CC states, not just idle/completed

---

## Quality Gates — Mandatory Before Any PR

### Athena's Quality Gates (2026-04-10 01:28 UTC)

1. ✅ `npm run build` — TypeScript compilation succeeds
2. ✅ `npm test` — All tests pass
3. ✅ `node dist/server.js` — Production build starts without crash
4. ✅ **Manual UAT** — Test feature via curl, check UI, verify end-to-end flow
5. ➡️ **Only then** — Create PR

### Argus's Review Gates (2026-04-10 01:38 UTC)

1. **UAT evidence required in PR body:** "I tested this manually and it works"
2. **Diff >500 lines** → Immediate REQUEST_CHANGES (no exceptions)
3. **server.ts + dashboard simultaneously** → Flag for scope split
4. **Wrong branch (main vs develop)** → Immediate CLOSE (no review)

---

## Team Learning Points — Consolidated

1. **Path verification prevents 4-hour blockers** (Hephaestus)
2. **git status verification prevents false progress** (Hephaestus)
3. **Manual UAT is critical, not just tests** (All agents)
4. **Large diffs indicate scope contamination** (Argus) — >500 lines → reject
5. **CI green ≠ software works** (Argus) — Automated tests pass ≠ end-to-end works
6. **Reviewing code in isolation misses end-to-end failures** (Argus)
7. **Territory violations must be respected** (Daedalus)
8. **UAT evidence required in PR body** (All)
9. **Stall detection must handle all CC states** (Hephaestus) — Including "Cogitated" mode
10. **VIBE_CODER_BIBLE is shared memory file only** (Ema correction) — Do NOT commit to repository

---

## Ongoing Web Research Directive

### From Ema (2026-04-10 01:34 UTC)

**Task:**
- All team members perform periodic web research
- Keep VIBE_CODER_BIBLE_WITH_AEGIS updated continuously
- Research topics:
  - Claude Code best practices and workflows
  - AEGIS usage patterns for production
  - Vibe coding techniques and methodologies
  - Enterprise coding standards
  - Testing and UAT best practices
  - AI-assisted development workflows

**Purpose:**
- Keep VIBE_CODER_BIBLE current with industry best practices
- Learn from community discussions (Reddit, Twitter/X, HN)
- Incorporate new techniques as they emerge
- Maintain expert-level knowledge

**Frequency:** Ongoing task — not one-time. Perform regularly.

---

*Created: 2026-04-10*
*Team: AEGIS Development Team*
*Purpose: Shared knowledge base for expert AI-assisted development using AEGIS*
*Status: INTERNAL FILE ONLY — Do NOT commit to repository*

---

## AEGIS Usage Best Practices — Daedalus

### UAT Gaps in Dashboard PRs

**Problem:**
- Dashboard PRs passed CI but had UAT gaps
- Login flow didn't work end-to-end despite tests passing
- UI components existed but weren't wired into router
- This resulted in Ema having to manually fix "a lot of shit"

**Root Causes:**
1. **Territory Violations** — Dashboard code touched server.ts routes without explicit ownership
2. **No Manual Browser Testing** — Relied on automated unit tests only
3. **No End-to-End Verification** — Component-level tests ≠ integration works

**Learnings:**
1. **UAT is mandatory for UI work:**
   - Open browser, actually click buttons
   - Verify login flow from start to finish
   - Check all routes are registered in router
   - Don't trust unit tests for integration

2. **Territory respect:**
   - Dashboard (React/frontend) shouldn't touch server.ts routes
   - Separate concerns: UI vs backend API
   - Use API endpoints, don't edit routes directly

3. **Quality before PR:**
   - Build dashboard, start server, actually use it
   - Click every button, verify every page loads
   - Only then declare PR ready

**Action Items for Next Task:**
1. Manual browser testing for all dashboard PRs
2. Verify all routes registered in router before PR
3. Respect territory boundaries (UI vs API)
4. End-to-end flow testing, not just component tests

---

## AEGIS Usage Best Practices — Manudis

### Expert User Development with AEGIS

**Context:** As an expert user using AEGIS to develop AEGIS itself (dogfooding), here are the critical workflows:

**Before Starting Work:**
1. **Verify AEGIS server is healthy:**
   ```bash
   curl -s http://127.0.0.1:9100/health | jq '.status'
   ```
   
2. **Create isolated git worktree:**
   ```bash
   cd ~/projects/aegis
   git worktree add -b feature/issue-N origin/develop
   ```

3. **Set up config copy in worktree:**
   - Copy `settings.local.json` with proper AEGIS token
   - Ensure MCP tools are available
   - Verify workdir is correct (character-by-character)

**During Development:**
1. **Use AEGIS MCP tools (NOT AEGIS sessions):**
   - `aegis_create_session` with proper workdir
   - `aegis_send_message` for prompts
   - `aegis_get_transcript` for verification
   - NEVER use `claude -p` or `curl` directly

2. **Monitor CC behavior actively:**
   - Check for "Cogitated" extended thinking mode
   - Watch for stall conditions (5+ minutes inactivity)
   - Verify prompt delivery via capture-pane
   - Nudge if stall detected

3. **Review code in AEGIS context:**
   - Read files via workspace (not just CC output)
   - Run tests inside AEGIS session
   - Verify build succeeds inside session

**After CC Completes:**
1. **Verify changes persist:**
   ```bash
   git status
   git diff --name-only
   ```
   
2. **Manual UAT (Critical):**
   - Start production build: `npm run build && node dist/server.js`
   - Test API endpoints: `curl http://localhost:9100/v1/sessions`
   - Test actual feature functionality
   - Only then declare complete

3. **Quality gate:**
   ```bash
   tsc --noEmit && npm run build && npm test
   ```

4. **Commit in worktree:**
   ```bash
   git add -A && git commit -m "feat: description"
   git push origin feature/issue-N
   ```

**Before Creating PR:**
1. **Verify all tests pass:** Actually run them, don't just trust CC
2. **Verify build succeeds:** Check for compilation errors
3. **Manual feature test:** Actually use the feature, don't just look at code
4. **Verify PR targets develop:** NOT main (unless explicitly release promotion)
5. **Include AEGIS version in PR body:**
   ```bash
   curl -s http://127.0.0.1:9100/v1/health | jq .version
   ```

6. **Verify PR body has:**
   - Issue URL: `https://github.com/OneStepAt4time/aegis/issues/N`
   - UAT evidence: "I tested this manually and it works"
   - Correct commit convention (feat:, fix:, refactor:)

**Clean Up After PR:**
1. **Remove worktree:**
   ```bash
   git worktree remove feature/issue-N
   ```
2. **Verify develop is clean:**
   ```bash
   git checkout develop
   git pull --rebase
   ```

**Critical Learnings:**
1. **Dogfooding requires isolation** — Worktrees prevent contamination
2. **Manual UAT is non-negotiable** — Tests passing ≠ software works
3. **Monitor CC state** — "Cogitated" is a valid stall condition
4. **Verify paths character-by-character** — Prevents 4-hour blockers
5. **Quality gates apply to everyone** — Even expert users must follow them

---

## Reviewer Perspective — Argus

### Quality Issues Caught in Reviews (That Shouldn't Have Been PRs)

**PRs That Shouldn't Have Been PRs:**
- #1547 (20K lines) — Subagent dumped coverage artifacts into diff
- #1549 (15K lines, wrong branch, duplicate of #1527) — Hephaestus branched from main
- #1543 (duplicate of #1542) — Same issue, two PRs from same author

**Quality Issues Approved but Ema Had to Fix:**
- Dashboard auth flow (#1573) — LoginPage component existed but wasn't in router
- /v1/auth/verify endpoint — Missing entirely, dashboard couldn't log in
- These passed CI but didn't work end-to-end

**Root Cause:**
> "I was reviewing code in isolation instead of verifying the feature worked as a whole. CI green ≠ done."

**Learnings:**
1. **Reviewing code in isolation misses integration failures** — Must verify feature works end-to-end
2. **UAT evidence is critical in review** — Require "I tested this manually and it works" in PR body
3. **Diff size indicates scope contamination** — >500 lines → immediate REQUEST_CHANGES, no exceptions
4. **Wrong branch → immediate CLOSE** — main vs develop, no review needed
5. **server.ts + dashboard → flag for scope split** — Should be separate PRs

**New Review Standards Going Forward:**
1. UAT evidence required in PR body
2. Diff >500 lines → immediate REQUEST_CHANGES
3. server.ts + dashboard simultaneously → flag for scope split
4. Wrong branch (main vs develop) → immediate CLOSE
5. CI green is necessary but NOT sufficient — verify feature actually solves problem

---

## Quality Gates — Consolidated (All Team)

### Mandatory Before Any PR (Athena — 2026-04-10 01:28 UTC)

1. ✅ `npm run build` — TypeScript compilation succeeds
2. ✅ `npm test` — All tests pass
3. ✅ `node dist/server.js` — Production build starts without crash
4. ✅ **Manual UAT** — Test feature via curl, check UI, verify end-to-end flow
5. ➡️ **Only then** — Create PR

### Review Gates (Argus — 2026-04-10 01:38 UTC)

1. UAT evidence required in PR body
2. Diff >500 lines → immediate REQUEST_CHANGES
3. server.ts + dashboard simultaneously → flag for scope split
4. Wrong branch (main vs develop) → immediate CLOSE

---

## Team Learning Points — Consolidated (All 5 Agents)

1. **Path verification prevents 4-hour blockers** (Hephaestus)
2. **git status verification prevents false progress** (Hephaestus)
3. **Manual UAT is critical, not just tests** (All agents)
4. **Large diffs indicate scope contamination** — >500 lines → reject (Argus)
5. **CI green ≠ software works** (Argus)
6. **Reviewing code in isolation misses end-to-end failures** (Argus)
7. **Territory violations must be respected** — UI vs API separation (Daedalus)
8. **UAT evidence required in PR body** (All agents)
9. **Diff >500 lines → instant reject** (Argus)
10. **VIBE_CODER_BIBLE is shared memory file only** (Ema correction) — Do NOT commit to repository
11. **Stall detection must handle all CC states** — Including "Cogitated" mode (Hephaestus)
12. **Manual browser testing for UI work** — Don't trust unit tests (Daedalus)
13. **Dogfooding requires isolation** — Worktrees prevent contamination (Manudis)
14. **Monitor CC state actively** — Watch for stalls, extended thinking (Manudis)
15. **Quality gates apply to everyone** — Even expert users must follow them (Argus)

---

## Scribe Retrospective — Docs Issues That Shipped Wrong

**Problem:**
- Documentation PRs had issues that required manual fixes
- PRs were merged before issues were fully resolved
- Examples include getting started guide, API documentation gaps

**Root Cause:**
1. **No manual verification** — Relied on automated checks only
2. **Incomplete review** — Docs weren't actually tested end-to-end
3. **Pressure to ship** — Documentation treated as lower priority

**Learnings:**
1. **Documentation is product, not afterthought** — Must verify docs work
2. **Manual doc testing required** — Actually follow guide steps
3. **Doc quality gates needed** — Links work, examples compile, accuracy verified
4. **Don't merge docs until verified** — Same quality standards as code

**Action Items:**
1. Manual verification of all documentation changes
2. Test all guide examples before PR
3. Verify all links work (no 404s)
4. Apply same quality gates to docs as code

---

## VIBE_CODER_BIBLE — Complete (2026-04-10 01:55 UTC

**Status:** ✅ COMPLETE — All 5 team retrospectives added

**Contributors:**
- ✅ Hephaestus — AEGIS usage best practices (developer)
- ✅ Daedalus — AEGIS usage best practices (UI/dashboard)
- ✅ Manudis — AEGIS usage best practices (expert user/dogfooding)
- ✅ Argus — Retrospective insights (reviewer perspective)
- ✅ Scribe — Retrospective insights (docs perspective)

**Sections Included:**
- Vibe Coding Guide (from Claude artifact)
- AEGIS Usage Best Practices — Hephaestus (developer)
- AEGIS Usage Best Practices — Daedalus (UI/dashboard, UAT gaps)
- AEGIS Usage Best Practices — Manudis (expert user, dogfooding)
- Reviewer Perspective — Argus (quality issues caught)
- Scribe Retrospective — Docs issues that shipped wrong
- Quality Gates — All team consolidated
- Team Learning Points — 15 key lessons consolidated

**Ownership:**
- Location: `~/projects/aegis/memory/VIBE_CODER_BIBLE_WITH_AEGIS.md`
- Contributors: All 5 team members
- Purpose: Internal shared knowledge base for expert AI-assisted development
- **Critical:** Do NOT commit to repository

---

## Team Collaboration — COMPLETE (2026-04-10 01:55 UTC)

**All 5 Retrospectives:**
- ✅ Hephaestus — Workdir/stall issues, verification gaps
- ✅ Daedalus — UAT gaps, territory violations
- ✅ Manudis — Expert user dogfooding workflows
- ✅ Argus — Review failures, new standards
- ✅ Scribe — Docs issues that shipped wrong

**VIBE_CODER_BIBLE:**
- ✅ File created: `~/projects/aegis/memory/VIBE_CODER_BIBLE_WITH_AEGIS.md`
- ✅ All 5 team retrospectives added
- ✅ Vibe Coding Guide integrated
- ✅ Quality gates consolidated
- ✅ Team learning points consolidated (15 lessons)
- 📋 Internal memory file only (do NOT commit to repository)

**Team Ready:** All retrospectives complete, team is unblocked.

---

## Final Status — 2026-04-10 01:55 UTC

**My Blockers:**
1. 🔒 AEGIS auth token still missing
2. 🔒 Cannot create sessions until auth restored

**Mode:** 😴 Complete standby — All retrospectives complete, VIBE_CODER_BIBLE created. Awaiting explicit go signal from Ema.

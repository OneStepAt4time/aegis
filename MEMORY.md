
---

## GitHub Communication Rule (5 Apr 2026)

**MAI taggare utenti GitHub nei commenti/issues/PR** — a meno che non sia intenzionale e necessario (utente esterno che va coinvolto).

Tutti i commenti degli agenti appaiono sotto l'account **OneStepAt4time** — qualsiasi @mention sembra fatto da Emanuele.

**Comunicazione inter-team** → solo su Discord. GitHub è per lavoro, non per chat.

---

## Giornata 5-6 Aprile 2026 — Lezioni Critiche

### Autonomous Development Strategy — APPROVATA con riserve
Design doc per branching strategy con `develop` branch, versioning, graduation, issue lifecycle.

**Voto team:** 8/10 medio

**Approccio incrementale:**
- Step 0: Rafforzare branch protection su main (doppio approval: Argus + Ema)
- Step 1: `develop` branch + cherry-pick workflow
- Step 2: Tiered CI (Linux-only su PR)
- Step 3: Graduation automation
- Step 4: Optimization

**Implementazione:** in pausa — Ema ha fermato tutto il team per procedere direttamente.

### Versioning Alpha
- npm deprecate: 61 versioni v2.x deprecate
- Release pubblicate: v0.1.0, v0.1.1 (ma v0.1.0 pubblicata senza -alpha — bug)
- Fix: release-please manifest aggiornato a 0.1.0-alpha
- Future releases: 0.1.x-alpha

### Release Gate — Lezione Appresa
Ema ha bloccato tutti i merge alle 19:44 UTC perché il suo "wait" era arrivato 39 secondi DOPO il merge effettivo di #1238. Nonostante fosse "colpa" della rete, il principio è: ZERO merge senza OK esplicito di Ema.

**Regola ferrea:** Prima di qualsiasi merge, aspettare la conferma esplicita di Ema. Anche se "CI è green".

### GitHub Communication Rule
MAI taggare utenti GitHub nei commenti — tutti i commenti appaiono sotto l'account OneStepAt4time (Ema). Comunicazione inter-team solo su Discord.

### Quality Standards
- **Scribe**: docs professionali, niente placeholder, review Argus obbligatoria
- **Daedalus**: UI enterprise grade, zero placeholder, pixel perfect, accessibilità
- **Team**: Zero work senza issue assegnata

### Stop Directive (6 Apr 2026, 00:15 UTC)
Ema ha fermato TUTTO il team alle 00:15 UTC. Nessun agent tocca il repo fino a suo avviso esplicito.

Ragione: sembra che ci fosse un problema di sicurezza o governance che richiedeva intervento diretto.

### Issue Assignment Rule
OGNI issue su cui si lavora DEVE essere assegnata prima di iniziare. Nessun lavoro senza assegnazione.

### Verification Gate — Rafforzato
I claim degli agenti devono essere verificati PRIMA di confermare. "Published" → npm view. "Merged" → gh pr diff. "Green" → verificare CI reale.

---

## Workflow Attuale (sospeso)
1. Feature branch da main
2. PR su main
3. CI green
4. Argus review
5. Ema OK esplicito
6. Merge

Il design `develop` branch cambierà questo flusso.

---

## Week 1 — Nuovo Branch Workflow (6 Apr 2026, 00:30 UTC)

### Regola Ferrea
**Tutte le PR degli agenti → `develop`, mai `main`.**

Eccezioni (solo se esplicitamente richiesto da Ema):
- Hotfix critici
- Operazioni di release / maintainer bootstrap

### Branch Structure
- **`main`**: solo release-ready, mai PR standard
- **`develop`**: integration buffer per tutte le PR di lavoro
- Feature branch → PR verso `develop`

### Nuovo Workflow
```
git checkout -b feature/NOME origin/develop
# sviluppo...
git push -u origin feature/NOME
gh pr create --base develop
```

### Limiti Temporanei (fino Wave 2)
- Nessuna PR nuova verso `main`
- Nessun cambio autonomo alla branch strategy
- Se conflitti o dubbi → escalation

### Checklist Prima di Aprire PR
- [ ] Branch da `origin/develop` (non da `origin/main`)
- [ ] PR con `--base develop`
- [ ] Issue assegnata a me
- [ ] CI green
- [ ] Argus review + Ema OK (per release)

## Nuove Regole Operative — 6 Aprile 2026, 12:13 UTC

**Da Ema (Disaster):**

### 1. Base Branch
- Lavorare da `origin/develop`
- Tutte le PR standard → `develop`
- Mai PR verso `main` salvo esplicita istruzione

### 2. Sessioni CC via Aegis
- **MAI `bypassPermissions`** come default
- Usare `permissionMode: "default"`
- Quando CC entra in:
  - **plan_mode** → leggere il piano e rispondere (usare la plan mode di Superpowers, non la plan mode nativa di CC)
  - **ask_question** → rispondere esplicitamente (leggere cosa CC ha chiesto e cosa ha risposto, NON tutto il transcript)
  - **permission_prompt** → valutare e approvare/rifiutare o chiedere approfondimento
- **MAI killare la sessione senza leggere transcript/summary**

### 3. Supervisione
- NO fire-and-forget
- Controllare stato periodicamente
- Preferire sessioni supervisionate bene a molte sessioni aperte male
- Supervisore attivo = leggere pane, analizzare, rispondere

### 4. Quality Gate (OBBLIGATORIO)
```
npx tsc --noEmit
npm run build
npm test
```
Senza evidenza dei check → task NON finito.

### 5. Escalation
Se:
- Conflitto
- CC bloccato
- Non si sa se approvare
- Il task richiede giudizio ambiguo
→ Fermarsi e chiedere `needs-human` o istruzioni

### 6. Regola di Comportamento
**Meno velocità, più qualità.**
Meglio una PR buona e verificata che tre PR da correggere dopo.

---

## Session dump 2026-04-06 20:30 UTC

### Today's PRs (Hephaestus)
- PR #1266: SHA256 checksums as release asset (#1171) ✅
- PR #1268: SPDX SBOM generation via cyclonedx-npm (#1169) ✅
- PR #1270: Zod schema validation for config file (#1109) ✅
- PR #1271: Fastify decorateRequest type-safe authKeyId (#1108) ✅
- PR #1272: .gitignore TLS/key/credential patterns (#1106) ✅
- PR #1273: Dependabot dashboard coverage (#1110) ✅
- PR #1274: needsFastPolling only when hooks configured (#1097) ✅
- PR #1275: async execFileAsync replacing blocking execFileSync (#1096) ✅
- PR #1276: detectWaitingForInput uses stored byteOffset (#1095) ✅
- PR #1280: ESLint flat config + Prettier + lint CI step (#1104) ✅
- PR #1290: Telegram allowlist empty → all users rejected (#1087) ✅
- PR #1299: Smoke test auth fix (REJECTED - wrong fix) ❌
- PR #1300: Auth guard negation bug fix (#1080 regression) ✅

### Sub-agents spawned
- fix-1081-path-bypass → PR #1286 ✅ (path.normalize before prefix check)
- fix-1080-auth-guard → PR #1289 ✅ (auth guard when binding non-localhost)
- fix-1085-timing-safe → PR #1288 ✅ (timingSafeEqual for hook secrets)
- fix-1089-sse-route → PR #1287 ✅ (exact path match for SSE routes)
- fix-1090-signal-handler → STILL RUNNING (process.exit after cleanup)

### Lessons learned
- ALWAYS check `gh pr list --state merged --search "<issue>"` before starting work — ghost task waste
- Athena's issue list was stale — 4 ghost tasks in a row before she fixed verification
- `prefer-const` ESLint rule fires incorrectly on SSEWriter write() pattern — disabled
- Auth guard logic: `if (!auth && isLocalhost)` skip, NOT `if (!auth && !isLocalhost)`
- Sub-agent spawn can fail silently — always check PR creation output
- Worktree naming: use branch name from PR title, not issue number (fix/1087-telegram-auth-bypass vs fix/1087-telegram-auth)

### Team dynamics
- Manudis (Ema) prefers direct communication in Discord — short, factual
- Daedalus had 4 false positive dashboard tests — routed wrongly
- Argus sometimes reports PRs as merged when they're not — always verify independently
- STOP directive: all dev halted for UAT, then resumed
- UAT found: SSE global event schema mismatch (connected/heartbeat dropped) — Daedalus fixed
- Dashboard rebuilt issue: `npm run build` only compiles backend TS, not React dashboard

### CI blockers
- `npm audit` failures blocked all PRs (vite 8.0.3) → fixed by merging #1282 (vite 8.0.5)
- Smoke test 401 after auth guard → fixed by correcting negation in server.ts line 370
- macOS test failures #1228 — Ema handling personally

### Open items
- #1090: signal handler process.exit (sub-agent still running)
- #1280: ESLint PR — awaiting Argus review
- #1297: release 0.2.0-alpha — pending

## Promoted From Short-Term Memory (2026-04-22)

<!-- openclaw-memory-promotion:memory:memory/2026-04-16.md:129:131 -->
- - Candidate: Possible Lasting Truths: **Decision:** Applied emergency direct implementation exception (SOUL.md rule 4). ### Delivered - `src/channels/telegram.ts`: - Converted standalone `tgApi()` to private instance method (removed global `rateLimitUntil`) - Removed duplicate HTML escaping f - confidence: 0.00 - evidence: memory/2026-04-16.md:89-91 [score=0.838 recalls=0 avg=0.620 source=memory/2026-04-16.md:8-10]

## Promoted From Short-Term Memory (2026-04-23)

<!-- openclaw-memory-promotion:memory:memory/2026-04-18.md:169:171 -->
- - Candidate: Possible Lasting Truths: **Decision:** Applied emergency direct implementation exception (SOUL.md rule 4). ### Delivered - `src/channels/telegram.ts`: - Converted standalone `tgApi()` to private instance method (removed global `rateLimitUntil`) - Removed duplicate HTML escaping f - confidence: 0.00 - evidence: memory/2026-04-17.md:139-141 [score=0.849 recalls=0 avg=0.620 source=memory/2026-04-18.md:8-10]

## Promoted From Short-Term Memory (2026-04-24)

<!-- openclaw-memory-promotion:memory:memory/2026-04-19.md:109:111 -->
- - Candidate: Possible Lasting Truths: **Decision:** Applied emergency direct implementation exception (SOUL.md rule 4). ### Delivered - `src/channels/telegram.ts`: - Converted standalone `tgApi()` to private instance method (removed global `rateLimitUntil`) - Removed duplicate HTML escaping f - confidence: 0.00 - evidence: memory/2026-04-16.md:129-131 [score=0.854 recalls=0 avg=0.620 source=memory/2026-04-19.md:53-55]
<!-- openclaw-memory-promotion:memory:memory/2026-04-20.md:84:86 -->
- - Candidate: Possible Lasting Truths: **Decision:** Applied emergency direct implementation exception (SOUL.md rule 4). ### Delivered - `src/channels/telegram.ts`: - Converted standalone `tgApi()` to private instance method (removed global `rateLimitUntil`) - Removed duplicate HTML escaping f - confidence: 0.00 - evidence: memory/2026-04-17.md:139-141 [score=0.810 recalls=0 avg=0.620 source=memory/2026-04-20.md:53-55]

## Promoted From Short-Term Memory (2026-05-07)

<!-- openclaw-memory-promotion:memory:memory/2026-04-30.md:7:7 -->
- All PRs from the original split are merged except the last one: [score=0.850 recalls=0 avg=0.620 source=memory/2026-04-30.md:7-7]

## Promoted From Short-Term Memory (2026-05-10)

<!-- openclaw-memory-promotion:memory:memory/2026-05-03.md:19:19 -->
- Athena filed 10 new backend bugs (all ready, no needs-human): [score=0.866 recalls=0 avg=0.620 source=memory/2026-05-03.md:19-19]

---

## Strategic Refocus — 16 May 2026

### Target: Solo Dev / Small Team (1–100 CC agents, self-hosted)
Phase 4 (enterprise) DEFERRED indefinitely. No SSO, multi-tenancy, Postgres default, K8s, billing, quotas until paying customer signs.

### The Filter
"Does this make Aegis better for the solo developer who approves agents from their phone, today?"
- Yes → build it
- Maybe → don't
- Enterprise → deferred

### This Week
One feature, full team convergence. Ema picks tomorrow. Bar: value in under 5 minutes.

### ADR-0024 forthcoming (supplements 0023)
Single MIT edition. No Free/Enterprise split.

### What Stays
Bug fixes (P0/P1), security fixes, CC bridge core, local gate, branching rules, worktree convention.

### Worktree Cleanup
All agents audit + finish-or-kill their worktrees by Friday EOD. Ema kills anything remaining.

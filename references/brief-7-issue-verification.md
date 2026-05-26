# Brief #7 — Issue Verification Protocol

**Author:** Team Aegis (Hephaestus, Argus, Athena, Daedalus)
**Date:** 2026-04-02
**Status:** Team Approved — Pending Ema Sign-off
**Requested by:** Ema

---

## 1. AS IS — Current State

### 1.1 Il problema
Una fix compila e passa CI, ma nessuno verifica che il bug sia davvero risolto.
Le issue vengono chiuse dopo merge senza conferma della risoluzione reale.

### 1.2 Per ogni ruolo

**Hephaestus (Developer)**
- Riceve issue da Athena, crea sessione CC, CC sviluppa fix
- Quality gate: tsc + build + test — verifica che il codice compili, non che il bug sia fixato
- Non scrive regression test per ogni fix
- Non documenta come ha verificato che il fix risolve il problema
- Apre PR → Argus reviewa → merge → issue chiusa
- Nessuna tracciabilità fix ↔ issue

**Argus (Reviewer)**
- Reviewa il codice della PR per qualità, sicurezza, patterns
- NON verifica che la PR risolva il bug descritto nell'issue
- NON richiede test di regressione
- Merge e chiude issue senza evidenza di risoluzione
- Per issue complesse (performance, SSRF, TOCTOU) la review del codice non basta

**Athena (PM/Triage)**
- Assegna issue a Hep, tracko PR aperte
- Chiude issue quando PR è mergiata — automatico, senza conferma
- Nessun modo di verificare che il fix risolva il problema reale
- Nessun feedback loop: se il fix non funziona, l'issue resta chiusa
- Zero visibility su regression (bug tornato)
- Esempi concreti:
  - #606 (bloated diffs): come sapere se le sessioni CC producono diff puliti?
  - #622/#623/#624 (performance): come verificare che il fix performi meglio? Nessun benchmark before/after
  - Security fixes: come verificare che l'exploit non funziona più?

**Daedalus (Dashboard)**
- Dashboard mostra PR e issue ma non lo stato di verifica
- Non può dire se un fix è stato verificato end-to-end
- Utente finale non ha modo di vedere se un bug è realmente risolto

### 1.3 Consequence
- Bug chiusi ma non risolti → utente trova il bug ancora presente → zero confidence
- Regression non detectate → stesso bug riaperto mesi dopo
- Performance fix non misurate → impossibile sapere se il fix ha migliorato qualcosa
- Security fix non verificate → exploit potrebbe ancora funzionare

---

## 2. TO BE — Target State

### 2.1 Principio
Una issue è "risolta" solo quando:
1. La PR è mergiata ✅
2. CI passa (tsc + build + test) ✅
3. **La risoluzione del bug è verificata** ✅ ← MANCANTE OGGI

### 2.2 Tre Layer di Verifica

**Layer 1: Regression Test (Hephaestus)**
Ogni fix DEVE includere un test che riproduce il bug.
- Il test DEVE fallire prima della fix e passare dopo
- Se il bug non è testabile automaticamente: documentare step di verifica manuale nel PR body
- CC session include nel prompt: "write a regression test that fails before your fix and passes after"

**Layer 2: Review Gate (Argus)**
Argus nel review verifica tre cose:
1. Code quality (già fatto)
2. Regression test presente? (NUOVO)
3. PR body ha sezione "Verification" con metodo e risultato? (NUOVO)
- PR senza regression test (unless justified) → REJECT
- PR senza sezione Verification → REJECT

**Layer 3: Closure con Conferma (Athena)**
- Issue si chiude SOLO dopo: PR merged + verification confirmed
- Chiude l'issue DEVE scrivere commento: "Verified on [env]: [cosa testato, da chi]"
- Reopen rule: se il bug torna → label regression + priorità immediata
- Athena nei batch assignment include: "nel PR body includi come hai verificato il fix + env/test usati"

### 2.3 Dashboard Integration (Daedalus)
- Colonna "Verification Status" nella issue view: passed / failed / pending / manual
- PR card mostra: regression test? verification section?
- Issue detail mostra: chi ha verificato, quando, su che env

---

## 3. Proposed Workflow

### 3.1 Flusso completo
```
1. Issue aperta (con reproduction steps obbligatori)
   ↓
2. Athena assegna batch → Hep crea sessione CC
   Prompt CC include: "write regression test first, then fix"
   ↓
3. CC scrive fix + regression test
   Quality gate: tsc + build + test
   ↓
4. Hep apre PR con body:
   - "Fixes #X"
   - "Regression test: test/xxx.test.ts (or: manual verification steps)"
   - "Verification: tested on [env], result: [pass/fail]"
   ↓
5. Argus review:
   - Code quality ✅
   - Regression test present? ✅
   - Verification section? ✅
   - Se manca qualcosa → REJECT con feedback
   ↓
6. Merge → verification result salvato in Aegis
   ↓
7. Athena chiude issue con commento:
   "✅ Fixed in PR #X. Verified by [who] on [env]. Regression test: test/xxx.test.ts"
   ↓
8. Dashboard mostra verification status per ogni issue
```

### 3.2 Issue Template (nuovo)

```markdown
## Bug Description
[What happened?]

## Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Expected vs Actual]

## Environment
- Aegis version: [x.y.z]
- Skill version: [x.y.z]
- CC version: [x.y.z]
- Node.js: [version]
- OS: [distro]

## Severity
- [ ] Crash / Data loss
- [ ] Security vulnerability
- [ ] Performance degradation
- [ ] Incorrect behavior
- [ ] UI/UX issue
```

### 3.3 PR Template (nuovo)

```markdown
## Summary
Fix for #[issue number]: [brief description]

## Changes
- [change 1]
- [change 2]

## Regression Test
- [ ] Unit test: `test/xxx.test.ts` — reproduces bug, fails before fix, passes after
- [ ] Manual verification: [steps taken, env, result]
- [ ] N/A — reason: [why not testable]

## Verification
- Environment: [local / CI / staging]
- Aegis version: [x.y.z]
- Result: tsc ✅ build ✅ test ✅ (X tests pass)
- Manual test: [what was tested, outcome]

## Fixes
Fixes #[issue number]
```

---

## 4. Implementation Plan

### Phase 1: Templates + Rules (1 day)
- [ ] Create `.github/ISSUE_TEMPLATE/bug_report.md` with reproduction steps + environment
- [ ] Create `.github/pull_request_template.md` with regression test + verification sections
- [ ] Update Argus review checklist: reject PR without regression test or verification
- [ ] Update Athena batch template: include "include verification in PR body"

### Phase 2: CC Prompt Enhancement (1 day)
- [ ] Update CC skill prompt: "always write regression test first"
- [ ] Update Aegis session creation: auto-inject "write test that fails before fix" in prompt
- [ ] Test: session CC produces regression test for a real issue

### Phase 3: Verification Protocol in Aegis (3-5 days)
- [ ] Implement `POST /v1/sessions/:id/verify` endpoint (issue #749)
- [ ] Auto-verify after session completion: tsc + build + test
- [ ] Store verification result linked to session + issue
- [ ] API: `GET /v1/sessions/:id/verification`
- [ ] Webhook notification on verification complete

### Phase 4: Dashboard (3-5 days)
- [ ] Add "Verification Status" column to issue list
- [ ] Show regression test status on PR cards
- [ ] Issue detail: who verified, when, env
- [ ] Filter issues by verification status

### Phase 5: Enforcement (ongoing)
- [ ] Issue without reproduction steps → label `needs-reproduction`, Athena follows up
- [ ] PR without regression test → Argus rejects
- [ ] Issue closed without verification comment → Athena reopens
- [ ] Regression bug → label `regression`, auto-prioritize P0

---

## 5. Effort Estimate

| Phase | Duration | Owner |
|-------|----------|-------|
| 1. Templates + Rules | 1 day | Hep + Argus |
| 2. CC Prompt | 1 day | Hep |
| 3. Verification API | 3-5 days | Hep + CC sessions |
| 4. Dashboard | 3-5 days | Daedalus |
| 5. Enforcement | ongoing | Athena + Argus |
| **Total** | **8-12 days** | |

**Quick wins (oggi):** Phase 1 + 2 = 2 giorni. Tutto il resto è enhancement.

---

## 6. Metrics

| Metric | AS IS | TO BE |
|--------|-------|-------|
| Issue con regression test | ~10% | 90%+ |
| PR reject per mancanza verifica | 0 | Track |
| Issue riaperte (regression) | Unknown | Tracked |
| Tempo medio verifica per issue | N/A | < 5 min (auto) |
| Confidence utente finale | Bassa | Alta |

---

## 7. Team Agreement

- **Hephaestus**: scrivo regression test per ogni fix, includo verification nel PR body
- **Argus**: reject PR senza regression test o verification section
- **Athena**: chiudo issue solo con evidenza di verifica, includo verification request nei batch
- **Daedalus**: aggiungo verification status alla dashboard

---

## 8. Open Questions

1. Per issue non testabili (es. UI subtlety): accettiamo verifica manuale documentata?
2. Per performance fixes: richiediamo benchmark before/after?
3. Per security fixes: richiediamo PoC che dimostri l'exploit non funziona più?

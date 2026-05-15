# Hephaestus Fix Plan — 27 Marzo 2026

_Creato da Boss dopo audit di Emanuele_

## Problemi riscontrati

1. 🔴 Zero GitHub release pubblicate dopo v1.1.0 (5 tag orfani: v1.2.1-v1.3.3)
2. 🔴 Hep usa `claude -p` invece di Aegis per fixare Aegis (bypass)
3. 🔴 Hep sviluppa sul codice della release stessa invece che dogfooding (Release X → X+1)
4. 🔴 CC models hardcoded su glm-5-turbo, non usa glm-5.1
5. 🟠 Superpowers skills non installate (solo `aegis-task.md`, mancano workflow/worktree/etc)
6. 🟠 2 worktree orfani non puliti (fix/304, fix/305)
7. 🟠 SOUL.md ha regole corrette ma Hep le ignora sistematicamente

---

## Azioni

### ✅ DONE
- [x] 1. Pulire worktree orfani (fix/304, fix/305 rimossi)
- [x] 2. Aggiornare CC models a glm-5.1 (tutte e 3 env vars in settings.local.json)
- [x] 3. Anti-bypass rules nel SOUL.md (sezione "⛔ Vincoli Non Negoziabili" aggiunta con 6 regole)
- [x] 4. Release automation nel HEARTBEAT.md (gh release create obbligatorio, checklist 11 step)
- [x] 5. GitHub release retroattive pubblicate: v1.2.1, v1.3.0, v1.3.1, v1.3.2
- [x] 6. v1.3.3 verificata + flag "latest" corretto

### 🔲 TODO
- [ ] 7. Verificare che Hep legge i file aggiornati al prossimo heartbeat

---

## Log

### Task 1 ✅ — Pulire worktree orfani
- `git worktree remove --force` per fix/304-stale-closure e fix/305-unsafe-any-cast
- Rimasti solo worktree attivi (nessuno)

### Task 2 ✅ — Aggiornare CC models
- `.claude/settings.local.json`: glm-5-turbo → glm-5.1 per haiku/sonnet/opus

### Task 3 ✅ — Anti-bypass rules
- Aggiunta sezione "⛔ Vincoli Non Negoziabili — LEZIONE DEL 27 MARZO 2026" in SOUL.md
- 6 regole: no claude -p, no edit diretto, no dev su main, dogfooding, superpowers sempre, escala non bypass
- Sistema di conseguenze: 1° nota, 2° perdi autonomia, 3° review completo

### Task 4 ✅ — Release automation
- HEARTBEAT.md Step 5 riscritto: 11 step obbligatori
- `gh release create` ora step obbligatorio post-tag
- Checklist: changelog → tag → gh release → build → deploy → health → state → annuncio

### Task 5 ✅ — Release retroattive
- v1.2.1: note generate da git log (nessun changelog esistente)
- v1.3.0, v1.3.1, v1.3.2: note estratte dal CHANGELOG.md
- Tutte pubblicate su GitHub, v1.3.3 confermata come "latest"

### Task 7 🔲 — Verifica Hep
- Da fare dopo il prossimo heartbeat di Hep

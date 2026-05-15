# Telegram Message Style Guide — LoLStonks Team

_Regola d'oro: leggibile in 2 secondi. Se devi scrollare, è troppo lungo._

---

## I 6 Tipi Standard

### ① QUICK UPDATE (70% dei messaggi)
One-liner. Emoji status + testo + dato chiave.

```
🟢 CI verde su `main` — 150/150 test ✅
```
```
⚠️ `sess-4a7b` in stall — 47m, recovery NUDGE
```
```
🔨 PR #14 merged — session timeout config
```

**Regole:**
- Una riga, max due
- Emoji di stato all'inizio: 🟢✅⚠️🔴❌🔨🚀
- Dati tecnici in `monospace`
- Nessun bottone (salvo eccezioni)
- Nessun separatore

---

### ② TASK COMPLETATO
Post-merge/completamento. Quality gate visuale.

```
✅ *issue-7* — Session timeout config
⏱ `28 min` · 🌿 `feat/session-timeout`
✅ tsc · ✅ build · ✅ 152/152 test
```

**Bottoni (1 riga):**
```
[✅ Merge | 👀 Review | ❌ Chiudi]
```

**Regole:**
- 3 righe max di testo
- Quality gate su una riga con · come separatore
- Branch in monospace
- 1 riga di bottoni: Merge (success), Review, Chiudi (danger)

---

### ③ ALERT / ERRORE
Qualcosa si è rotto. Azione richiesta.

```
🔴 *Session crash* — `sess-4a7b`
```Exit 137 (OOM) · task: issue-12
Last output: 3m ago```
```

**Bottoni (1 riga):**
```
[🔄 Riavvia (primary) | 📜 Log | ⏸ Ignora]
```

**Regole:**
- Emoji 🔴 o 🚨 all'inizio
- Box monospace SOLO per dati tecnici (exit code, error msg)
- Max 3 righe nel box monospace
- 1 riga di bottoni con azione primaria evidenziata
- Mai più di 5 righe totali

---

### ④ SÌ / NO
Domanda binaria. Zero ambiguità.

```
Il test `timeout.test.ts` fallisce su CI. Skippo e creo issue dedicata?
```

**Bottoni (1 riga):**
```
[✅ Sì (success) | ❌ No, fixxa ora (danger)]
```

**Regole:**
- Domanda diretta, 1-2 righe
- Contesto minimo necessario
- 2 bottoni: positivo (success) e negativo (danger)
- Il "No" include cosa succede se clicchi
- Mai più di 2 bottoni

---

### ⑤ DECISIONE TECNICA
Scelta architetturale con contesto. L'unico tipo che ammette 2 righe di bottoni.

```
Multi-backend: quale pattern?

*Strategy* — interface `Backend`, pulito, testabile
*Plugin* — `aegis.register()`, estendibile, più complesso
```

**Bottoni (2 righe):**
```
[🏗 Strategy (primary) | 🔌 Plugin (primary)]
[🤷 Decidi tu | 💬 Parliamone]
```

**Regole:**
- Domanda in bold sulla prima riga
- Opzioni: nome in bold + dash + descrizione one-liner
- Max 3 opzioni (se di più → poll nativo)
- Riga 1: le opzioni (tutte primary)
- Riga 2: SEMPRE escape hatch ("Decidi tu" + "Parliamone")
- Max 5 righe di testo

---

### ⑥ PROGRESS
Operazioni lunghe. Feedback visivo.

```
🔄 *Deploy v1.0.5*
✅ tsc `2.1s` · ✅ build `4.3s` · ✅ test `8.7s`
🔄 restart service...
`████████████░░` 85%
```

**Bottoni (1 riga):**
```
[⏸ Pausa | ❌ Annulla (danger)]
```

**Regole:**
- Step completati su una riga con · separatore
- Step corrente su riga dedicata con 🔄
- Barra progresso ASCII: `█` per completato, `░` per rimanente
- Percentuale alla fine della barra
- Aggiornare via editMessageText (mai nuovo messaggio!)
- 1 riga di bottoni: Pausa + Annulla

---

## Regole Globali

### Bottoni
- **Max 2 righe** (3 solo per Decisione Tecnica)
- **Max 3 bottoni per riga**
- **Stili:** `success` = azione positiva, `danger` = distruttiva, `primary` = neutrale importante
- **Escape hatch** obbligatorio per decisioni: "🤷 Decidi tu" / "💬 Parliamone"

### Formattazione
- **Bold** (`*text*`): titoli, nomi issue, label importanti
- **Monospace** (`` `text` ``): hash, branch, comandi, numeri, timing
- **Code block** (` ``` `): SOLO per error output tecnico
- **Italic** (`_text_`): note, commenti secondari — usare raramente
- **Separatori** (━━━): max 2 per messaggio, solo in dashboard/report on-demand

### Emoji Status (coerenti ovunque)
| Emoji | Significato |
|-------|-------------|
| 🟢 | Online / OK / Running |
| ✅ | Completato / Passed |
| ⚠️ | Warning / Sotto soglia |
| 🔴 | Errore / Crash / Down |
| ❌ | Fallito / Rifiutato |
| 🔄 | In corso / Loading |
| 🔨 | Lavoro fatto (Hephaestus) |
| 🚀 | Deploy / Release |
| ⚡ | Zeus |
| 😈 | manudis23 |

### Anti-pattern (MAI fare)
- ❌ Messaggi che richiedono scroll
- ❌ Più di 3 righe di bottoni
- ❌ Separatori ━━━ in quick update
- ❌ Monospace per testo normale
- ❌ Emoji decorative senza significato
- ❌ Mandare nuovo messaggio invece di edit per refresh/update
- ❌ Bottoni senza callback handler dietro
- ❌ Wall of text con "dettagli" — usa bottone "📋 Dettagli" che espande on-demand

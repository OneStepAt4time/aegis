
## ISSUE DIAGNOSTICATO — Agent Response Bug — 21:43 UTC

**Sintomo:**
- Team alignment check inviato da Manudis
- Agenti (Hephaestus) non rispondono alle normali domande/aggiornamenti
- Agenti rispondono solo quando taggati direttamente (`@Hephaestus`)
- Messaggi che non sono tag diretti → 0 risposte

**Root Cause TROVATA da Manudis (Disaster):**
```json
{
  "Boss": {},           // config vuota — usa defaults
  "ag-hep": {
    "requireMention": true  // ← QUI IL PROBLEMA
  }
}
```

**Tutti gli agenti hanno `requireMention: true` nel channel config** → significa:
- ✅ Rispondono quando taggati direttamente (`@Hephaestus`)
- ❌ NON rispondono ai messaggi normali (senza tag)

**Fix richiesto da Manudis:**
Cambiare `requireMention: true` → `requireMention: false` per tutti gli agenti nel channel `1490085572826501358` (#aegis-devs).

**Impact:**
- Team alignment checks e comunicazioni ordinarie falliscono
- Solo @mention diretto funziona
- Bug nella configurazione del channel, non nel codice degli agenti

**Nota:** Ho fatto SAL 21:41 UTC, ricevuto reazioni 👨‍💻 che indicano riconoscimento ma no response.

**Severity:** P0 — blocca completamente la comunicazione team

**Proprietà:**
- Bug è nella configurazione channel su Discord (non codice repo)
- Richiede intervento di Manudis per fixare config
- Non posso fixare io — solo Manudis può configurare agent permissions


# VIBE_CODER BIBLE WITH AEGIS
*Come usare Claude Code via Aegis in modo serio — by the Aegis team*

---

## Prima di Iniziare

### 1. Verifica il Workdir
```bash
# IL workdir corretto è SEMPRE:
/home/bubuntu/projects/aegis

# NON USARE MAI:
/home/buntu/      # manca "ub"
/home/bubuntu/aegis/  # sbagliato
/tmp/             # temporaneo, perde tutto
```

### 2. Verifica che Aegis Sia UP
```bash
curl http://localhost:9100/v1/health
# Deve tornare {"status":"ok",...}
```

### 3. Check Issue Su GitHub PRIMA di iniziare
- L'issue è già chiusa/merged?
- Qualcuno ci sta già lavorando?
- Apri l'issue sul browser e LEGGI i dettagli completi

---

## Durante lo Sviluppo

### 4. UAT Obbligatorio (non solo test)
Dopo `npm test -- --run`, DEVI:
- APRI IL DASHBOARD e clicca attraverso la feature
- Curl l'endpoint API e verifica la risposta
- Testa gli stati di errore (404, empty, loading)
- Verifica `node dist/server.js` parte senza crash

### 5. Quality Gate Locale (sempre tutti e 3)
```bash
cd dashboard
npx tsc --noEmit        # 1. TypeScript clean
npm run build             # 2. Build passa
npm test -- --run         # 3. Test passano
```
Solo dopo tutti e 3 → commit e push.

### 6. Scope Minimo per PR
- Una feature per PR
- Non mischiare fix, refactor e feature insieme
- Se trovi altra roba da sistemare → altra issue, altra PR

### 7. Verifica Prima di Commit
- I file modificati sono solo quelli che servono?
- Hai toccato solo il tuo territorio?
- I test sono reali o mock falsi?

---

## Errori Comuni (NON FARE)

### ❌ Non fare mai:
- `/home/buntu/` invece di `/home/bubuntu/`
- Pushare senza aver runnato build + tests localmente
- Creare PR senza verificare che CI passi
- Aprire sessioni Aegis senza specificare workdir corretto
- Mischiare 3 issue in una PR
- Ignorare errori TypeScript ("tanto passano i test")
- Non verificare l'output del CC session prima di chiuderla

### ✅ Fare sempre:
- Leggere l'issue completa prima di toccare codice
- Verificare workdir prima di ogni sessione
- Runnare TSC + build + test prima di pushare
- Fare UAT reale (dashboard + click)
- Chiudere la sessione Aegis quando hai finito
- Commentare l'issue quando inizi e quando fai PR

---

## Il Workflow

```
1. Leggi issue su GitHub
2. Verifica Aegis è UP + workdir corretto
3. Crea sessione Aegis con workdir giusto
4. Sviluppa la feature
5. UAT locale (dashboard + click)
6. TSC + build + tests (DEVONO PASSARE TUTTI E 3)
7. Commit + push
8. Apri PR + commenta su GitHub issue
9. Notify Argus per review
```

---

## Checklist Completa Prima di PR

- [ ] `npm run build` ✅
- [ ] `npm test` ✅
- [ ] `node dist/server.js` parte senza crash ✅
- [ ] UAT manuale: curl l'endpoint, verifica UI ✅
- [ ] Solo allora → apri PR

---

## Retrospective: Cosa è Andato Storto

### Daedalus
- PR "passavano i test" ma non funzionavano nell'UAT reale
- Mi sono fidato dell'output CC session senza verificare indipendentemente
- Sessione sparkline ha modificato `src/` invece di `dashboard/` — territorio sbagliato

### Hephaestus
- 15+ tentativi con workdir sbagliato (`/home/buntu/` invece di `/home/bubuntu/`)
- Ha aperto PR per issue già merged senza verificare
- Sessioni CC fabricat e non verificate

### Scribe (in attesa)

### Argus (in attesa)

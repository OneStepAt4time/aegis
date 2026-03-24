# Report: Internals di Claude Code — API, Runtime, Lifecycle

**Data:** 2026-03-24 | **Fonti:** module-cli-3869558.js, module-bun-internal-852753.js, late-module-215M.txt, react-hooks-region.txt, anthropic-api-region.txt, claude-core-strings.txt, color-diff.js, image-processor.js

---

## 1. Come Claude Code chiama l'API Anthropic

### Multi-Provider
CC supporta 4 provider:
- **Anthropic diretto** (`ANTHROPIC_API_KEY`)
- **AWS Bedrock** (`CLAUDE_CODE_USE_BEDROCK`)
- **Google Vertex AI** (`CLAUDE_CODE_USE_VERTEX`)
- **Foundry** (`CLAUDE_CODE_USE_FOUNDRY`)

### Region Mapping (Vertex AI)
```javascript
[
  ["claude-haiku-4-5", "VERTEX_REGION_CLAUDE_HAIKU_4_5"],
  ["claude-opus-4", "VERTEX_REGION_CLAUDE_4_0_OPUS"],
  ["claude-sonnet-4-6", "VERTEX_REGION_CLAUDE_4_6_SONNET"],
  ["claude-sonnet-4-5", "VERTEX_REGION_CLAUDE_4_5_SONNET"],
  ["claude-sonnet-4", "VERTEX_REGION_CLAUDE_4_0_SONNET"],
]
```

### Model Overrides
CC supporta mapping Anthropic model ID → provider-specific model ID (es. Bedrock ARN). Configurabile via managed settings.

### State Tracking API
Per ogni chiamata API, CC traccia:
- `lastAPIRequest` / `lastAPIRequestMessages` — payload inviato
- `lastApiCompletionTimestamp` — quando completò
- `totalAPIDuration` / `totalAPIDurationWithoutRetries` — durata con/senza retry
- `modelUsage` — per-model: `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `webSearchRequests`
- `totalCostUSD` / `tokenSaverBytesSaved` / `tokenSaverHits`

### Credenziali
- `oauthTokenFromFd` / `apiKeyFromFd` — token via file descriptor
- `sessionId` via `crypto.randomUUID()`
- `parentSessionId` — sessioni annidate (teammate mode)

---

## 2. Buffered Output (1000ms)

CC usa un buffered writer con:
- Flush interval: **1000ms**
- Max buffer: **100 entries**
- `immediateMode` — bypass buffer per output real-time

**Per Aegis:** Il capture-pane di tmux può avere fino a 1s di delay rispetto all'output effettivo di CC.

---

## 3. Gestione Immagini

5 moduli nativi Bun proprietari (`.node` files compilati):
- `image-processor.node` — processing immagini
- `color-diff.node` — coloring diff
- `tree-sitter-bash.node` — parsing bash
- `audio-capture.node` — cattura audio
- `file-index.node` — indicizzazione file

I file `.js` nella directory `.claude-internals/` sono solo **stub 10-riga** che wrappano questi moduli. Non sono estraibili/replicabili.

Immagini passate all'API come `content` block con `source.type: "base64"`.

---

## 4. Lifecycle dei Moduli

```
Bun bytecode → CJS wrapper → Native module loading (5 .node files)
→ State initialization (NfL) → OpenTelemetry setup → Settings loading (G69)
→ Hook registration (CDH) → CLI parsing → Session loop
```

### Settings Priority (in ordine)
```
policySettings → flagSettings → localSettings → projectSettings → userSettings
```

### State Iniziale Sessione
`NfL()` crea lo stato con:
- Tutte le variabili di tracking API
- Session metadata
- Hook callbacks
- Model configuration
- Feature flags

---

## 5. Hook System Internals

### Registration
```javascript
function CDH(H) { // registerHookCallbacks
  for (let [$, A] of Object.entries(H)) {
    if (!T$.registeredHooks[L]) T$.registeredHooks[L] = [];
    T$.registeredHooks[L].push(...A);
  }
}
```

Plugin hooks hanno `pluginRoot` che li distingue dagli user hooks.

### Duration Tracking
- `turnHookDurationMs` — durata hook per turno
- `turnHookCount` — numero hook per turno
- `addSlowOperation` — log per operazioni lente (threshold: `CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS`)

### Enterprise Controls
- `disableAllHooks` — disabilita tutto
- `allowManagedHooksOnly` — solo managed settings
- `allowedHttpHookUrl` patterns con wildcard

---

## 6. Plugin System (v2.x)

- Plugin manifest: `.claude-plugin/marketplace.json`
- Source types: `url`, `github`, `git`, `npm`, `pip`, `file`, `directory`
- Scopes: `managed`, `user`, `project`, `local`
- Dependency management tra plugin

---

## 7. Output Terminal per Parsing

- Output ANSI-colored (diff coloring via native module)
- Spinner personalizzabili via settings
- `statusLine` — comando custom per riga di stato (riceve JSON via stdin)
- `--output-format json` — possibile output strutturato
- `outputStyle: "string"` — stile output assistant
- `prefersReducedMotion: true` — riduce animazioni

---

## 8. Variabili d'Ambiente dal Bundle

| Variabile | Scopo |
|-----------|-------|
| `CLAUDE_CODE_ENTRYPOINT` | `sdk-ts`, `sdk-py`, `sdk-cli`, `unknown` |
| `CLAUDE_CODE_REMOTE` | Remote mode |
| `CLAUDE_CODE_REMOTE_MEMORY_DIR` | Custom memory dir per remote |
| `cleanupPeriodDays` | Retention JSONL (default 30, 0 = disabilita) |
| `sessionCronTasks` | Task schedulati dentro sessione |

---

## 9. Impatto su Aegis

### Pattern Fondamentali

1. **Buffered output 1s** — capture-pane ha delay. Non aspettarsi output istantaneo.
2. **Multi-provider** — se Aegis supporta Bedrock/Vertex, l'env setup è diverso.
3. **StatusLine JSON** — `context_window` % e `rate_limits` per monitoring reale.
4. **`cleanupPeriodDays`** — controlla quando CC auto-cancella i JSONL. Aegis deve scoprire le sessioni prima che vengano pulite.
5. **5 moduli nativi** — inaccessibili. Non possiamo replicare image processing.
6. **Settings priority** — policy > flag > local > project > user. Il permission guard deve considerare l'ordine.
7. **GrowthBook feature flags** — server-side, non forzabili. Aegis non può cambiare il comportamento di CC via feature flags.
8. **`sessionCronTasks`** — CC supporta task schedulati. Potenziale per heartbeat.
9. **Teleport sessions** — CC supporta sessioni "teletrasportate". Rilevante per multi-session.

# 🔨 Claude Code Source — Team Briefing

**Data:** 2026-03-31  
**Fonte:** Repo leakata `nirholas/claude-code` — 2075 file TS, ~537K righe  
**Report dettagliati:** `references/cc-analysis-*.md` (6 file)

---

## ARCHITETTURA GENERALE

### Stack
- **Runtime:** Bun (non Node.js) — TSX nativo, `bun:bundle` per feature flags
- **UI:** React + Ink (terminal TUI con Yoga layout engine)
- **CLI:** Commander.js
- **Validazione:** Zod v4 ovunque
- **Bundle:** esbuild + Bun

### Pattern Principale
**Query-Engine-Driven State Machine** con generator-based streaming:
```
CLI Parser → Setup/Migrations → QueryEngine → LLM API → Tool Loop → Terminal UI
```

### Startup
- Parallel prefetches (keychain, MDM) per hide ~200ms latency
- 11 migration files per backward compatibility
- Feature gates via `bun:bundle` (compile-time DCE)

---

## 1. TOOL SYSTEM (IL PIÙ IMPORTANTE PER AEGIS)

### Interfaccia Tool
Ogni tool è un oggetto con:
- `name`, `aliases`, `searchHint`
- `inputSchema` (Zod), `outputSchema`
- `call()` — esecuzione
- `isEnabled()` — feature gate
- `isReadOnly()` — safety
- `isConcurrencySafe()` — parallel execution
- `checkPermissions()` — defense-in-depth

### Pattern: `buildTool()` factory
Helper che registra tutto con fail-closed defaults. Ogni tool è auto-contenuto in una directory.

### 44 Tool Directory
BashTool (più complesso, 2600+ linee perm), FileRead/Write/Edit, Grep/Glob, WebFetch, WebSearch, Agent, Skill, MCP, TaskCreate/Get/Update/List/Stop, Workflow, Monitor, Brief, e altri feature-flagged.

### Permission System (8 layer)
1. CLI flags > session > policy > settings > hooks > classifiers
2. Modalità: `bypassPermissions`, `plan`, `default`, `auto`, `acceptEdits`, `dontAsk`
3. Bash: AST parsing + ML classifiers per determinare danger level
4. Hook `PreToolUse` può override/block

### Execution Flow
```
Selection → Validation (Zod) → Permission Check → 
Hook (PreToolUse) → Tool Call → Progress Reporting → 
Post-Execution Hook → Result Persistence
```

### Per Aegis
- **ADOPTARE:** `buildTool()` pattern con Zod schemas
- **ADOPTARE:** Permission model granulare (non solo allow/deny)
- **ADOPTARE:** `isReadOnly()` + `isConcurrencySafe()` su ogni tool
- **ADOPTARE:** Hook lifecycle (PreToolUse, PostToolUse, PermissionRequest)

---

## 2. CONTEXT & COMPACTION

### Dual Context
- **System Context** (git, date, env) — memoized per conversazione
- **User Context** (CLAUDE.md files) — cached e filtered

### Compaction Strategies (CRITICAL)
- **Cache-aware compaction:** Usa agent forked per condividere prompt cache → **salva 50-70K token per compact**
- **Budget system:** 50K per files, 25K per skills, per-item caps
- **API-round grouping** (non human-turn) per finer granularity
- **Progressive fallback:** Auto-compact 90% → partial compact → PTL retry → restore recent

### Per Aegis
- **CRITICO:** Implementare cache-aware compaction per sessioni lunghe
- **CRITICO:** Budget partitioning per tipo di contenuto
- API-round grouping > human-turn grouping

---

## 3. STATE MANAGEMENT

### Dual Layer
- **Global Singleton** (56K line file!) — performance-critical, session-scoped
- **Reactive Store** — UI-facing, immutable, subscriber pattern (signal-based)
- Bridge pattern syncs le due layer

### Per Aegis
- Separare state performance-critical da state reattivo
- Signal-based reactivity per la dashboard

---

## 4. TASK SYSTEM (Multi-Agent)

### Unified Abstraction
- Tipi: `LocalShellTask`, `LocalAgentTask`, `RemoteAgentTask`, `DreamTask`
- Disk-based output streaming (JSONL files)
- Background/foreground switching
- Message caps (50 items per teammate)

### Coordinator Mode
- Multi-agent orchestrazione via Agent tool
- Worker-based per parallel task execution
- Task notifications per result delivery

### Per Aegis
- **ADOPTARE:** Task abstraction unificata (non solo CC sessions)
- **ADOPTARE:** Coordinator mode per orchestrare multi-agent

---

## 5. MCP PROTOCOL

### Dual Role
- **Server:** Espone tools via stdio per orchestratori esterni
- **Client:** Connette a MCP servers esterni (5 transport: stdio, sse, http, websocket, claudeai-proxy)

### Connection Management
- Exponential backoff, OAuth, auto token refresh
- Batch connections per startup
- LRU caches per file state e auth

### Per Aegis
- **Aegis È un orchestratore MCP** — deve implementare client-side perfettamente
- Transport flexibility: non solo stdio, anche SSE/WebSocket

---

## 6. BRIDGE SYSTEM (Remote Control)

- Bridge main: 3000+ line orchestrator
- Multi-session (fino a 32 concurrent)
- 3 spawn modes: single-session, worktree, same-dir
- Proactive token management (OAuth + JWT refresh)
- Permission delegation: remote → local CLI

### Per Aegis
- **ADOPTARE:** Permission delegation pattern per sessioni remote
- **ADOPTARE:** Multi-session con worktree isolation

---

## 7. PROMPT ENGINEERING

### Dynamic Boundary Marker
```
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__
```
Separa contenuto statico (cacheable con `scope: global`) da dinamico (session-specific).

### Section Composition
- Ogni sezione = funzione condizionale
- Feature-gated via `bun:bundle`
- Memoized date per non bustare cache a mezzanotte

### Per Aegis
- **ADOPTARE:** Dynamic boundary per prompt caching
- **ADOPTARE:** Section-based composition
- **ADOPTARE:** Memoized context per cache stability

---

## 8. PLUGIN & SKILL SYSTEM

### Plugins
- Builtin (ship con CLI) + Marketplace (esterni)
- Componenti: skills, hooks, MCP servers
- Scope: user, project, managed, local

### Skills
- Fonti: bundled, directory-based, MCP-exposed, plugin-provided
- Frontmatter YAML per metadata
- Dynamic discovery durante session
- Conditional skills con path-filtered activation

### Per Aegis
- **ADOPTARE:** Skill system con frontmatter metadata
- **ADOPTARE:** Plugin architecture per estensibilità

---

## 9. SECURITY (Defense-in-Depth)

- OAuth 2.0 + JWT authentication
- Heap-only token storage (deleted from FS after load)
- `prctl(PR_SET_DUMPABLE, 0)` anti memory inspection
- Workspace trust required per hooks
- Fail-closed defaults ovunque

### Per Aegis
- **ADOPTARE:** Heap-only secrets
- **ADOPTARE:** Workspace trust per hooks/plugins
- **ADOPTARE:** Fail-closed defaults

---

## 10. PERFORMANCE OPTIMIZATIONS

- Parallel startup prefetches
- Lazy loading (tools, commands, schemas)
- LRU caches everywhere
- Ring buffers per activity tracking
- Double-buffered UI rendering
- Generator-based streaming (non callback)
- Dead-code elimination via `bun:bundle`

### Per Aegis
- **ADOPTARE:** Lazy loading per tools
- **ADOPTARE:** Generator-based streaming per sessioni
- **ADOPTARE:** Double-buffered output per tmux

---

## PRIORITÀ PER AEGIS

### P0 — Imitare Subito
1. **Tool pattern con `buildTool()`** — Zod schema + permissions + lifecycle
2. **Permission model granulare** — 8 layer, non solo allow/deny
3. **Hook system** — PreToolUse, PostToolUse, PermissionRequest
4. **Dynamic prompt boundary** — per prompt caching

### P1 — Implementare Prossimo
5. **Cache-aware compaction** — forked agent pattern
6. **Task abstraction unificata** — non solo CC sessions
7. **Coordinator mode** — multi-agent orchestration
8. **Dual state management** — performance + reactive

### P2 — Medium Term
9. **Plugin architecture** — estensibilità
10. **Skill system con frontmatter** — discovery
11. **MCP multi-transport** — non solo stdio
12. **Feature flags** — build-time DCE

---

*"Lo scudo di Zeus non si forgia guardando dall'esterno. Si forgia studiando l'arma perfetta e riproducendone l'essenza."* — Hephaestus

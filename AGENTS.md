<!-- AEGIS-OP-RULES-REF -->
> **MANDATORY READ BEFORE ANY ACTION:**
> 1. `OPERATIONAL-RULES.md` (this workspace) — team roster, Discord IDs, escalation, bug-report rules.
> 2. `IDENTITY.md` — who you are.
> 3. `SOUL.md` — how you think.
> 4. Repo `AGENTS.md` (root) + `ROADMAP.md` — current phase and policy (see SoT banner at bottom).
>
> If you skip `OPERATIONAL-RULES.md` you will violate team conventions. Re-read on every heartbeat.
<!-- /AEGIS-OP-RULES-REF -->
# AGENTS.md — Hephaestus Workspace

## Session Startup

0. Mandatory bootstrap guard: read required context files before any action.

```bash
cd /home/bubuntu/.openclaw/workspace-aegis
cat SOUL.md USER.md OPERATIONAL-RULES.md IDENTITY.md AGENTS.md
cat memory/$(date +%Y-%m-%d).md 2>/dev/null || true
cat memory/$(date -d 'yesterday' +%Y-%m-%d).md 2>/dev/null || true
cat state/current-task.json 2>/dev/null || true
```

1. `session_status` -> date/time (convert UTC -> Europe/Rome)
2. Read `SOUL.md` -> who you are
3. Read `USER.md` -> who Emanuele is
4. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
5. Read `state/current-task.json` -> active task?
6. Run HEARTBEAT.md

## Workspace

```
workspace-aegis/
├── SOUL.md              # Who I am
├── HEARTBEAT.md         # The dev loop
├── AGENTS.md            # This file
├── IDENTITY.md          # Name and role
├── USER.md              # Who Ema is
├── TOOLS.md             # Infra, API, Claude Code reference
├── memory/              # Daily logs
│   └── YYYY-MM-DD.md
├── state/               # Runtime state
│   ├── current-task.json
│   └── heartbeat-state.json
├── results.tsv          # Log of all tasks
├── evolution/           # Self-learning
│   └── lessons.jsonl
└── references/          # Claude Code docs, changelogs, etc.
```

## The Project: Aegis

- **Repo:** `OneStepAt4time/aegis` (public, MIT)
- **Local:** `/home/bubuntu/projects/aegis`
- **Stack:** TypeScript + Fastify + tmux
- **Branch default:** `main`
- **CI:** GitHub Actions (tsc + build + vitest)

## Prime Rule — Build Aegis Through Aegis

- All production implementation must be executed through Aegis-orchestrated Claude Code sessions.
- Treat Aegis sessions as interactive engineering sessions, not one-shot prompts.
- Use Claude Code session commands to inspect files, run checks, and steer implementation iteratively.
- If command availability is unclear, use Claude Code help in-session (for example `/help`) to list available commands.
- Do not implement features by coding directly outside Aegis sessions.
- Treat Claude Code output as draft engineering work: review every change before commit.
- Before opening any PR, require verification evidence (`tsc --noEmit`, build, tests) captured in session transcript.

## Development Workflow

### For each task:
```bash
cd /home/bubuntu/projects/aegis
git checkout main && git pull
git checkout -b feature/feature-name   # or fix/bug-name

# ... implement, test ...

npx tsc --noEmit          # Type check
npm run build              # Build
npm test                   # Vitest

git add -A
git commit -m "feat: description"
git push origin feature/feature-name
```
Then create a PR via `github-mcp-server_create_pull_request`.

### Dogfooding (when Aegis is operational):
1. Create an Aegis session to develop Aegis
2. Send a brief to Claude Code
3. Monitor and refine if needed
4. Verify output, merge only when green

## Claude Code Knowledge — MANDATORY

Aegis wraps Claude Code. If you do not know it deeply, you cannot develop Aegis safely.

### Sources (in order of priority)
1. **CC source code**: `anthropics/claude-code` on GitHub — read file by file, systematically
2. **CHANGELOG.md**: in the repo — monitor at every heartbeat
3. **CC issues**: `github-mcp-server_search_issues` query=`repo:anthropics/claude-code`
4. **npm**: `@anthropic-ai/claude-code` — check latest version vs installed
5. **Official docs**: https://docs.anthropic.com/en/docs/claude-code

### Files to maintain
- `references/claude-code-knowledge.md` — CC knowledge base (version, flags, JSONL, terminal states, bugs)
- `references/cc-source-reading-log.md` — log of what you have read from CC source

### How to read CC source
```
# Repo structure
github-mcp-server_get_file_contents owner=anthropics repo=claude-code path=/

# Read a specific file
github-mcp-server_get_file_contents owner=anthropics repo=claude-code path=src/cli.ts

# Search patterns
zread_search_doc repo_name=anthropics/claude-code query="terminal output"

# Directory structure
zread_get_repo_structure repo_name=anthropics/claude-code
```

### Cadence
- **Every heartbeat**: check CC version and scan CHANGELOG for updates
- **Every 3-4 heartbeats**: read 2-3 new source files and update the knowledge base
- **Every day**: review CC issues relevant to Aegis

## Memory

### Daily notes
- `memory/YYYY-MM-DD.md` — raw logs of what happened each day

### Long-term continuity
- `MEMORY.md` — curated memories (when created)

### Self-improving (compounding execution quality)
- `~/self-improving-ag-hep/memory.md` — HOT tier: preferences, patterns, rules
- `~/self-improving-ag-hep/corrections.md` — log of corrections received
- `~/self-improving-ag-hep/projects/` — project-specific lessons
- `~/self-improving-ag-hep/domains/` — domain-specific lessons
- `~/self-improving-ag-hep/heartbeat-state.md` — heartbeat review tracking
- `~/self-improving-ag-hep/index.md` — file index

### Proactivity (anticipate needs, follow through)
- `~/proactivity-ag-hep/memory.md` — durable proactive boundaries, activation preferences, delivery style
- `~/proactivity-ag-hep/session-state.md` — current objective, last decision, blocker, next move
- `~/proactivity-ag-hep/heartbeat.md` — recurring follow-ups worth re-checking
- `~/proactivity-ag-hep/patterns.md` — proactive wins worth reusing
- `~/proactivity-ag-hep/log.md` — proactive actions taken or suggested
- `~/proactivity-ag-hep/memory/working-buffer.md` — volatile breadcrumbs during long/fragile tasks

### Routing rules
- Factual events/context → `memory/YYYY-MM-DD.md`
- Correction, preference, workflow/style choice, performance lesson → `~/self-improving-ag-hep/`
  - Explicit correction → `~/self-improving-ag-hep/corrections.md`
  - Reusable global rule/preference → `~/self-improving-ag-hep/memory.md`
  - Domain-specific lesson → `~/self-improving-ag-hep/domains/<domain>.md`
  - Project-only override → `~/self-improving-ag-hep/projects/<project>.md`
- Durable proactive preference/boundary → `~/proactivity-ag-hep/memory.md`
- Current task state, blocker, next move → `~/proactivity-ag-hep/session-state.md`
- Volatile breadcrumbs, partial findings → `~/proactivity-ag-hep/memory/working-buffer.md`
- Repeat proactive win → `~/proactivity-ag-hep/patterns.md`
- Proactive action taken/suggested → `~/proactivity-ag-hep/log.md`
- Recurring follow-up → `~/proactivity-ag-hep/heartbeat.md`

### Pre-task loading
Before non-trivial work:
1. Read `~/self-improving-ag-hep/memory.md`
2. Read `~/proactivity-ag-hep/memory.md`
3. Read `~/proactivity-ag-hep/session-state.md` if task is active or multi-step
4. Read `~/proactivity-ag-hep/memory/working-buffer.md` if context is long, fragile, or likely to drift
5. List available domain/project files and read up to 3 matching ones

### Write It Down — No Mental Notes!
- When you learn a lesson → update the correct self-improving file immediately
- When you make a mistake → document it so future-you doesn't repeat it
- After a correction or strong reusable lesson, write it before the final response
- Keep entries short, concrete, one lesson per bullet
- Text > Brain 📝

## Communication

- **To Boss:** via `sessions_send` for milestones, decisions, blockers
- **To Emanuele:** via Boss (not directly)
- **On GitHub:** reply to each issue within 24h
- **Daily log:** `memory/YYYY-MM-DD.md`
- **results.tsv** — official record of each task

## Quality Gate (before every merge)

```bash
cd /home/bubuntu/projects/aegis
npx tsc --noEmit          # Zero TS errors
npm run build              # Build OK
npm test                   # All tests pass
```

All three must pass. No exceptions.
---

<!-- AEGIS-REPO-SOT-BANNER -->
## Repository Source of Truth (read before any task)

The Aegis repository is the single source of truth for policy, scope, and conventions:

- **Repo:** https://github.com/OneStepAt4time/aegis
- **Top-level policy:** `AGENTS.md` (root) — the master rules every agent must follow.
- **Current phase & scope:** `ROADMAP.md` — what we are building NOW; never act outside the active phase without Boss approval.
- **Scoped rules** (load on demand from `.claude/rules/`):
  - `workflow.md` — issue-to-PR loop, worktree convention, gate command.
  - `positioning.md` — what Aegis IS and IS NOT (BYO LLM bridge, MIT, single edition).
  - `branching.md`, `commits.md`, `prs.md`, `typescript.md` — engineering conventions.
- **Strategic positioning:** `docs/adr/0023-positioning-and-business-model.md`.
- **Pre-PR gate (mandatory):** `npm run gate` must pass; never push with `--no-verify`.

If this workspace's local rules ever conflict with the repo, **the repo wins**. Open a PR to update the repo first, then sync back here.

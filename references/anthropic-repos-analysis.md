# Anthropic Repos Analysis

_Clonati e analizzati: 22 Marzo 2026_

## 1. anthropics/claude-code
- **Repo:** https://github.com/anthropics/claude-code
- **Clonato:** no (read-only via web, sorgente non pubblico — solo README, plugins, changelog)
- **Stato:** v2.1.81, installazione via curl/brew (npm deprecated)

### Plugins (KEY per Aegis)
11 plugin ufficiali nel repo. Struttura standard:
```
plugin-name/
├── .claude-plugin/plugin.json
├── commands/        # Slash commands
├── agents/          # Specialized agents
├── skills/          # Agent Skills
├── hooks/           # Event handlers
├── .mcp.json        # MCP server config
└── README.md
```

**Plugin rilevanti per Aegis:**
- `code-review` — 5 parallel Sonnet agents, confidence scoring. Pattern per multi-agent in Aegis.
- `feature-dev` — 7-phase workflow. Simile al nostro dev loop.
- `hookify` — crea hook dinamicamente. Pattern per auto-config di Aegis.
- `ralph-wiggum` — loop iterativi, Stop hook per continuare. Pattern per stall recovery.
- `plugin-dev` — toolkit per sviluppare plugin. Reference per Aegis plugin system v2.0.

### Hook system
Events: SessionStart, PreToolUse, PostToolUse, Stop, StopFailure, Elicitation, ElicitationResult
Format: JSON hooks array in settings.json. Command type with timeout.

### Key insight for Aegis
CC ha un agent framework interno molto maturo. Aegis deve essere COMPLEMENTARE, non duplicare.
Aegis value: orchestrazione MULTI-sessione, monitoring, notification routing. CC value: singola sessione agentica.

## 2. anthropics/claude-cookbooks
- **Repo:** https://github.com/anthropics/claude-cookbooks
- **Clonato:** /home/bubuntu/projects/claude-cookbooks
- **43 notebook Jupyter** + patterns + skills

### Contenuto chiave
- `patterns/agents/` — Building Effective Agents reference implementation
  - Prompt chaining, routing, parallelization
  - Orchestrator-workers, evaluator-optimizer
- `claude_agent_sdk/` — 4 tutorial notebook (00-03)
  - Research agent, Chief of Staff, Observability, SRE
  - MCP integration, hooks, subagent orchestration
- `misc/session_memory_compaction.ipynb` — background compaction, instant swap
- `tool_use/` — tool integration patterns, customer service agent

### Implications for Aegis
- **Agent SDK** è il competitor diretto: wrappa CC per task generici, non solo coding
- **Orchestrator-workers pattern** è esattamente quello che Aegis fa: un orchestratore (Zeus) che delega a N worker (CC sessions)
- **Memory compaction** pattern applicabile: Aegis potrebbe auto-compact sessioni CC che si avvicinano al context limit

## 3. anthropics/prompt-eng-interactive-tutorial
- **Repo:** https://github.com/anthropics/prompt-eng-interactive-tutorial
- **Clonato:** /home/bubuntu/projects/prompt-eng-interactive-tutorial
- **9 capitoli** + appendici (tool use, search & retrieval)

### Contenuto
1. Basic Prompt Structure
2. Being Clear and Direct
3. Assigning Roles
4. Separating Data from Instructions
5. Formatting Output & Speaking for Claude
6. Precognition (Thinking Step by Step)
7. Using Examples (Few-Shot)
8. Avoiding Hallucinations
9. Complex Prompts from Scratch + industry use cases

### Relevance for Aegis
- Pattern per crafting better prompts da inviare a CC via Aegis
- "Separating Data from Instructions" → rilevante per come passiamo brief ai task
- "Avoiding Hallucinations" → rilevante per quality gate dei risultati CC

## Strategic Takeaways

1. **Claude Agent SDK è il futuro** — Aegis deve posizionarsi come complemento, non competere
2. **Plugin system di CC è maturo** — Aegis potrebbe diventare un CC plugin stesso
3. **Multi-agent patterns** ben documentati — Aegis v2.0 dovrebbe seguire l'orchestrator-workers pattern
4. **Hook system è il nostro punto di integrazione** — ma è fragile (Zeus bug)
5. **Memory compaction** è un problema reale — Aegis dovrebbe monitorare e auto-compact

_Last updated: 22 Marzo 2026, 11:10_

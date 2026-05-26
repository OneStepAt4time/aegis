# oh-my-claudecode vs Aegis — Detailed Comparison Analysis

> **Date:** 2026-04-01
> **Author:** Hephaestus (Subagent Analysis)
> **Purpose:** Strategic analysis to guide Aegis roadmap

---

## Executive Summary

**oh-my-claudecode (OMC)** and **Aegis** serve fundamentally different purposes:

| | OMC | Aegis |
|---|---|---|
| **Core Function** | CC plugin/orchestrator (inside CC) | HTTP bridge (outside CC) |
| **Architecture** | Skill + Agent system, hook-driven | REST API + tmux session manager |
| **User Interface** | Magic keywords, slash commands | HTTP API, MCP, Telegram |
| **Multi-Agent** | Team runtime (tmux CLI workers) | Session-level only (swarm awareness) |
| **Integration Target** | CC users (plugin) | AI orchestrators, CI/CD, external tools |

**Key Insight:** OMC is a **power-user plugin for CC**. Aegis is a **bridge for external systems to use CC**. They can coexist and even complement each other.

---

## 1. Architecture Comparison

### OMC Architecture

OMC runs as a **plugin inside Claude Code** with four interlocking systems:

1. **Hooks** — Event detection (UserPromptSubmit, Stop, PreToolUse, etc.)
2. **Skills** — Behavior injection (composable capabilities)
3. **Agents** — 32 specialized subagents with model routing
4. **State** — Compaction-resistant persistence (.omc/ directory)

### Aegis Architecture

Aegis runs as a **standalone HTTP server** that:

1. Creates tmux windows → launches CC inside
2. Sends messages via tmux send-keys
3. Parses output from terminal capture + JSONL transcripts
4. Detects state changes (working, idle, permission, stalled)
5. Fans out events to Telegram, webhooks, SSE

### Fundamental Difference

| Aspect | OMC | Aegis |
|--------|-----|-------|
| **Deployment** | CC plugin (inside CC process) | Standalone server (outside CC) |
| **Interface** | Slash commands + natural language | HTTP API + MCP + CLI |
| **Control Flow** | CC → OMC (push) | External → Aegis → CC (pull) |
| **State Source** | CC context + .omc/ files | tmux capture + JSONL transcript |

---

## 2. Session Management Comparison

### OMC Session Management

- **Team runtime** spawns multiple CLI workers in tmux panes
- **Task file system** for coordination (.omc/state/team/{team}/tasks/)
- **Heartbeat system** for worker health
- **Inbox/Outbox** for inter-worker messaging
- **Git worktree isolation** per worker
- **Phase controller** (plan → prd → exec → verify → fix)

### Aegis Session Management

- **tmux window per session** with JSONL parsing
- **State machine** (working → idle → permission_prompt → stalled)
- **Permission handling** via API (approve/reject)
- **Stall detection** (no output >5 min)
- **Session reuse** for idle sessions
- **Swarm monitor** for CC's native teammates

---

## 3. Multi-Agent Capabilities

### OMC Team Runtime

**Spawns N CLI workers** (Claude, Codex, Gemini) in tmux split panes:

- Multi-CLI support
- Task routing with capability matching
- Dynamic scaling (scaleUp/scaleDown)
- Branch merging coordination
- File-based message passing

### Aegis Swarm Monitor

**Passive discovery** of CC's native teammate sessions:

- Socket scanning for `-L claude-swarm-{pid}`
- Status aggregation across teammates
- Event emission (teammate_spawned, teammate_finished)

**Key Limitation:** Aegis does not SPAWN multi-agent teams — it only MONITORS CC's native team spawning.

---

## 4. API Surface Comparison

### OMC

- Slash commands: `/oh-my-claudecode:autopilot`, `/team`, `/ralph`
- Magic keywords: `autopilot`, `ralph`, `ultrawork`, `ccg`
- CLI: `omc team`, `omc ask`, `omc hud`
- MCP tools: Internal-only (notepad, project_memory)

### Aegis

- REST API: 21 endpoints (sessions, pipelines, health)
- MCP Server: 21 tools + 4 resources
- SSE streaming: Per-session events
- CLI: `aegis-bridge`, `aegis-bridge mcp`

---

## 5. Strengths of OMC

### 5.1 Skill-Based Orchestration
Auto-injection of behaviors based on triggers. Aegis has no skill system.

### 5.2 Multi-CLI Orchestration
Spawns Codex and Gemini alongside Claude. Aegis only manages Claude.

### 5.3 Agent Specialization
32 specialized agents with tiered model routing (Haiku/Sonnet/Opus). Cost optimization.

### 5.4 State Persistence
Notepad system survives CC context compaction. Aegis has no equivalent.

### 5.5 OpenClaw Integration
Native OpenClaw bridge with normalized signals. Aegis has no OpenClaw-specific integration.

---

## 6. Strengths of Aegis

### 6.1 Clean HTTP API
RESTful API that any system can use. OMC has no HTTP API.

### 6.2 MCP Server
Full MCP server with 21 tools + 4 resources. OMC's MCP tools are internal.

### 6.3 Session Reuse
Auto-reuses idle sessions for same workDir. OMC doesn't have explicit reuse.

### 6.4 Real-Time SSE Events
Per-session event streaming. OMC has no SSE/WebSocket.

### 6.5 Permission Remote Approval
Detect permission prompts and approve/reject via API. OMC uses CC's native UI.

### 6.6 Built-In Telegram Channel
Native Telegram integration. OMC requires OpenClaw for Telegram.

---

## 7. Missing in Aegis (Features to Adopt)

### Priority 1: Multi-Agent Orchestration
- Team API endpoint: POST /v1/teams
- Worker spawning with task distribution
- Inbox/Outbox message passing
- Git worktree isolation
- Branch merging

### Priority 2: Skill System
- Skill storage: ~/.aegis/skills/
- Trigger matching and auto-injection
- Skill management API

### Priority 3: Agent Specialization
- Agent templates with role prompts
- Model selection in create_session
- Cost tracking per agent

### Priority 4: State Persistence (Notepad)
- Notepad API: POST /v1/sessions/:id/notepad
- Retention policies with TTL
- Auto-injection into prompts

### Priority 5: Multi-CLI Support
- CLI abstraction: claude | codex | gemini
- Binary detection
- Cross-CLI teams

---

## 8. Missing in OMC (Aegis Advantages)

- HTTP API (OMC is slash commands only)
- MCP Server (OMC tools are internal)
- SSE Event Streaming
- Permission Remote Approval
- Pipeline API with dependencies

---

## 9. Market Positioning

| | OMC | Aegis |
|---|---|---|
| **Target** | Individual CC power users | AI orchestrators, CI/CD, teams |
| **Interface** | Natural language, slash commands | HTTP API, MCP |
| **Distribution** | CC marketplace, npm | npm |
| **GitHub Stars** | 11k+ | <1k |

**They don't directly compete.** OMC = Human → CC. Aegis = External → CC.

---

## 10. Strategic Recommendations

### Short-Term (v0.4.0)
1. Add Skill System
2. Add Agent Templates
3. Add Notepad API

### Medium-Term (v0.5.0)
4. Multi-Agent Team API
5. Inter-Session Messaging
6. Git Worktree Integration

### Long-Term (v0.6.0+)
7. Multi-CLI Support (Codex, Gemini)
8. OMC Compatibility Layer

---

## Conclusion

OMC and Aegis are **complementary, not competitive**.

**The winning strategy is integration:**
1. Aegis adopts OMC's best features (skills, agents, multi-agent)
2. Aegis exposes those features via HTTP API + MCP
3. OMC uses Aegis as transport for external orchestration

**Aegis should become the API layer for OMC's orchestration engine.**

---

*End of Analysis*

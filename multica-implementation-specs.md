# Multica Implementation Specs (Aegis reference)

This document contains prioritized implementation specs derived from Multica's feature set. It is a non-production reference branch (`spec/multica-features`). Do not merge directly into `develop`.

## Prioritized features (MVP + tests)

### 1) Skills (feature #3979)
- Purpose: register reusable solutions (skills) that agents can invoke or attach to session flows.
- Model:
  - Skill { id, name, description, tags, creatorKeyId, runtimeHints, exampleUsage }
  - SkillVersion { skillId, codeRef, artifacts, createdAt }
- APIs:
  - GET /v1/skills
  - POST /v1/skills
  - POST /v1/skills/:id/versions
- Tests:
  - Unit: model validation, versioning semantics
  - Integration: create skill -> call skill in an agent-run mock -> verify telemetry
- E2E: create skill via API, assign to session, verify agent can list and use skill.

### 2) Squads / Leader routing (#3981)
- Purpose: routing abstraction to group agents; leader decides delegation.
- Model:
  - Squad { id, name, leaderAgentId, memberAgentIds, routingPolicy }
- Routing algorithm:
  - Leader decides based on capability match or round‑robin. Leader is itself an agent instance.
- APIs and tests similar to Skills; integration verifies leader delegation path.

### 3) Autopilots (#3982)
- Purpose: long-running orchestrations powered by agents (pipelines, complex workflows).
- Design: workflows as DAGs with steps assigned to agents or squads. Runtime executes steps via Runner.
- Tests: unit for step scheduling, integration with Runner mock for execution.

### 4) Chat / Agent conversation UX (#3983)
- Purpose: messaging interface for agent responses, progress, questions.
- Design: persistent chat channels per session with WebSocket streaming and historical transcript.
- Tests: UI smoke + WS streaming simulation.

## Runner abstraction (backend sketches)
- Interface intended for runtime integration and agent execution.

API (pseudo):
- registerRuntime(runtimeId, metadata)
- unregisterRuntime(runtimeId)
- startTask({ runtimeId, taskSpec }) -> runId
- stopTask(runId)
- getRunStatus(runId)
- streamRunLogs(runId)

Security & telemetry: signed tokens, per-runtime capabilities; spans include agent_id/parent_agent_id (ties to #3946).

## Test & E2E requirements
- Each feature must include:
  - Unit tests (vitest)
  - Integration tests using mock Runners
  - E2E smoke: run local daemon + server in a worktree and execute a sample flow

## Non-functional constraints
- License: refrain from copying protected frontend assets or logos. Reimplement behaviors instead.
- Use git worktrees and `feat/` branches off `develop` for all feature work.
- No PRs until local E2E tests pass and Themis signs off on license/branding issues.


# Multica → Aegis Gap Analysis (summary)

NOTE: This file is a non-production reference spec. It summarizes features from the external Multica project and maps them to Aegis. No upstream code or assets have been copied into Aegis. See `multica-implementation-specs.md` for prioritized implementation details.

## Repo snapshot
- Source inspected: https://github.com/multica-ai/multica (README, SELF_HOSTING.md, CLI docs, LICENSE)
- Stack: Go backend, Next.js frontend, PostgreSQL (+ pgvector), local agent daemon + CLI, Docker images for self-host.
- License: Modified Apache-2.0 with additional commercial-use restrictions and logo/frontend clauses. Do NOT reuse frontend assets or logos without legal approval.

## High-level features Multica provides
- Agents-as-teammates: agent profiles, assignment lifecycle, activity timeline, progress reporting.
- Squads: leader-based routing (leader delegates tasks to squad members).
- Runner/Daemon: local agent daemon that discovers local CLIs, reports runtime capabilities, executes tasks, streams logs (WS).
- Skills registry: reusable task solutions as Skills for agents to reuse.
- Autopilots: higher-level agent orchestration / workflows.
- Self-host UX: one-command setup, Docker images, Brew install for CLI.
- Embedding/semantic features: pgvector usage for search/skills.

## Mapping to Aegis (high level)
- Agents-as-teammates: PARTIAL — Aegis has sessions/subagents but lacks persistent agent profiles + board-level agent assignee UX.
- Squads: MISSING — no stable leader-based routing primitive.
- Runner/Daemon: PARTIAL — Aegis uses MCP/embedded adapters; lacks strong local daemon auto-detection UX.
- Skills registry: MISSING/PARTIAL — transcripts & tools exist but no centralized skill registry.
- Autopilots: MISSING — higher-level orchestration not present as end-user feature.
- Self-host installer: PARTIAL — Aegis has workflows but Multica's one-command UX is smoother.
- Embedding/search: POSSIBLE GAP — depends on whether Aegis uses vector DB for context.

## Risks & License notes
- Multica LICENSE adds commercial-use constraints and forbids offering their frontend as a hosted SaaS without a commercial license. We will **not** copy branded frontend or logo assets.
- Use Multica as a behavioral/spec reference; reimplement behavior in Aegis rather than verbatim copying code.


# Agent Bootstrap Best Practice: GitHub as Source of Truth

> **Pattern:** Agents should read GitHub assignments on startup, not rely on channel messages or daily logs for task discovery.

## The Problem

When agents wake up (session start, heartbeat), they need to know what to work on. Three possible sources:

| Source | Reliability | Latency | Persistence |
|--------|------------|---------|-------------|
| **GitHub assignments** | High — canonical system of record | Near-zero | Persistent |
| **Channel messages** | Low — scrolls away, easy to miss | Variable | Ephemeral |
| **Daily logs / memory** | Medium — depends on what was captured | Stale | Session-bound |

## The Pattern

**On every session bootstrap, an agent should:**

1. `gh issue list --assignee @me --state open` — find your work
2. `gh pr list --author @me --state open` — check your open PRs
3. Then read channel messages / memory for context

GitHub is the canonical source. Everything else is supplementary context.

## Case Study: Hephaestus (2026-05-27)

**Before fix:** Hep's bootstrap read channel messages and daily logs for task discovery. When the team was active, messages scrolled fast. Hep appeared idle because he never checked GitHub assignments.

**After fix (one line):** Added `gh issue list --assignee aegis-hephaestus[bot]` to his startup sequence. Result: **31 PRs shipped in one day** — the architecture sequence (#4237 → #4246 ×8 → #4230 → #4229) plus Telegram one-tap (#4370), all landing clean.

**Diagnosis:** The agent wasn't broken. His bootstrap was.

## Bootstrap Sequence (Recommended)

```bash
# 1. GitHub assignments — PRIMARY source
gh issue list --repo OneStepAt4time/aegis --assignee aegis-<agent>[bot] --state open
gh pr list --repo OneStepAt4time/aegis --author aegis-<agent>[bot] --state open

# 2. Agent identity files — WHO you are
cat SOUL.md IDENTITY.md AGENTS.md

# 3. Recent memory — WHAT happened recently
cat memory/$(date +%Y-%m-%d).md
cat memory/$(date -d 'yesterday' +%Y-%m-%d).md

# 4. Channel context — WHY things are happening (supplementary)
# Read from session history / recent messages
```

## Priority Hierarchy

```
GitHub assignments (what to do NOW)
    ↓
Agent identity files (who you are, how you work)
    ↓
Recent memory (what happened recently)
    ↓
Channel messages (why, context, decisions)
```

## Why This Matters

- **Agents wake up fresh.** No session survives a restart. The bootstrap sequence is the only thing that determines what happens in the first 60 seconds.
- **Channel messages are lossy.** Mentions get missed, conversations scroll, context degrades.
- **GitHub is structured.** Assignees, labels, milestones, linked PRs — it's a task system, not a chat log.
- **One line fixed a "broken" agent.** The gap wasn't intelligence or capability — it was discovery.

## Anti-Patterns to Avoid

- ❌ Relying on channel pings as the primary task source
- ❌ Reading only memory/logs without checking GitHub
- ❌ Asking "what should I work on?" without first checking assignments
- ❌ Treating the heartbeat idle ping as a substitute for GitHub-driven work

## See Also

- [HEARTBEAT.md](../../HEARTBEAT.md) — heartbeat rules and idle behavior
- [AGENTS.md](../../AGENTS.md) — agent workspace conventions

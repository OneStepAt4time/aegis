---
name: real-test-coverage
description: Remove vitest exclusions and achieve real 70% coverage on core modules
status: active
created: 2026-04-14T16:35:00Z
updated: 2026-04-15T21:48:00Z
---

# PRD: Real Test Coverage

## Problem
Aegis has a vitest coverage threshold of 70%, but it passes by averaging well-covered utility modules against three large, integration-heavy files that are effectively at 0% coverage:
- `src/server.ts` — 1,102 lines, main entry point
- `src/session.ts` — 1,464 lines, SessionManager class
- `src/tmux.ts` — 1,010 lines, TmuxManager class

The 70% threshold is currently a mathematical artifact, not a signal of real test quality.

## Current Coverage Gap

| File       | Lines | Coverage | Gap                                                         |
| ---------- | ----- | -------- | ----------------------------------------------------------- |
| server.ts  | 1,102 | ~0%      | Auth helpers, channel registration, session reapers, inbound handler |
| session.ts | 1,464 | ~0%      | kill error path, escape(), submitAnswer(), getLatencyMetrics(), getSummary() |
| tmux.ts    | 1,010 | ~0%      | UI state detection, pane capture edge cases, zombie detection |
| Total      | 3,576 | ~0%      |                                                             |

## Target
Remove vitest exclusions and add minimum viable tests to bring real coverage to 70%.

## Phased Plan

### Phase 1 — session.ts unit tests (~1 week)
- Extract SessionManager methods with mocked TmuxManager + JsonlWatcher
- Cover: kill error path, escape(), submitAnswer(), getLatencyMetrics(), getSummary()
- File: `session.test.ts`

### Phase 2 — tmux.ts unit tests (~1 week)
- Mock tmux binary, test TmuxManager methods
- Cover: pane capture edge cases, zombie detection, UI state parsing
- File: `tmux.test.ts`

### Phase 3 — server.ts integration tests (~1 week)
- Extend `server-core-coverage.test.ts` pattern
- Cover: auth helpers, channel registration, session reapers, inbound handler
- Requires test config with mocked dependencies

## Definition of Done
- [ ] `npm test` runs full suite with 70%+ coverage
- [ ] All three files have documented test coverage >50% each
- [ ] No new coverage exclusions added without PR review

## Related Issues
- #1755 — parent issue

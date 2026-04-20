# Aegis Epics

Phase-level epics map the [ROADMAP](../../ROADMAP.md) to concrete scope. Each
epic file lists the items in that phase with labels, ADR references, and
acceptance criteria.

## Index

| Phase | Epic | Status | GitHub tracker |
|-------|------|--------|----------------|
| 1 | [Phase 1 — Foundations](./phase-1-foundations/epic.md) | **Active** | [#1915](https://github.com/OneStepAt4time/aegis/issues/1915) |
| 2 | [Phase 2 — Developer Delight + Team-Ready](./phase-2-developer-delight/epic.md) | Not active | — |
| 3 | [Phase 3 — Team & Early-Enterprise](./phase-3-team-early-enterprise/epic.md) | Not active | — |
| 4 | [Phase 4 — Enterprise GA](./phase-4-enterprise-ga/epic.md) | Not active | — |

Other epics (not phase-bound):

- [server-decomposition](./server-decomposition/) — internal refactor epic.

## Rules

1. **All phase planning issues are open on GitHub up front.** Non-active
   phases carry the `status: not-active` label on their tracker and all
   sub-issues, so the dependency tree is public but the work is gated.
2. **`status: not-active` means "do not start work".** Opening a PR that
   closes such an issue requires the maintainer to first remove the label
   (activation PR).
3. **A phase is activated** when the previous phase's exit criterion is met
   (see [ROADMAP Graduation Signals](../../ROADMAP.md#graduation-signals-alpha--preview--ga))
   AND the activation checklist in that phase's `epic.md` is ticked.
4. **Status transitions require a PR.** Changing an epic from "Not active"
   to "Active" happens in the same PR that removes the label on GitHub and
   updates `ROADMAP.md`.
5. **No speculative work.** Do not propose PRs for items outside the active
   phase without explicit maintainer assignment. See
   [.claude/rules/positioning.md](../rules/positioning.md).
6. **Scope stays in sync with the gap analysis.** Every item links back to
   its P0 / P1 / P2 id in
   [docs/enterprise/00-gap-analysis.md](../../docs/enterprise/00-gap-analysis.md).

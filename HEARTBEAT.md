# HEARTBEAT.md - AG Hephaestus

**Role:** Backend/API/CLI implementation, PR creation, dogfooding.

## Functional Code Gate (MANDATORY)

Read `/home/bubuntu/.openclaw/AGENTS_FUNCTIONAL_CODE_GATE_2026-05-31.md` before starting coding, review-fix, or PR work.

- A task is not done until it has acceptance criteria, a feedback loop, verification evidence, and a short residual-risk note.
- Prefer fixing red gates, broken dogfood flows, missing regression tests, flaky behavior, and review findings over adding new feature surface.
- Do not open a PR or claim readiness without exact commands run and results.
- If a check cannot run, report the blocker and the check that would prove the work.

## Default Backend Loop

1. Check assigned issues and open PRs before idle pings.
2. Reproduce bugs or define the target behavior before editing.
3. Add or update the smallest behavior/regression test that proves the change.
4. Implement one vertical slice only.
5. Run targeted tests first, then broader checks before PR readiness.
6. Include the Functional evidence template in status and PR handoff.

## Useful Aegis Gates

- Core/API/CLI: `npm run test`, `npm run build`, `npm run gate`.
- Architecture/shared code: `npm run gate:arch`, `npm run lint`, `npx tsc --noEmit`.
- Dogfood/E2E: `npm run test:e2e`, `npm run test:smoke`, or a real `ag run`/API flow with output summarized.

## Idle Rule

If no assigned work exists, first look for verification gaps: failing CI, open PR review comments, missing tests, dogfooding bugs, flaky tests, and issues labeled ready/bug. Ask for work only after that scan.

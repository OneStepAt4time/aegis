---
name: session-cockpit
status: proposal
created: 2026-04-20T15:10:00Z
phase: 2
depends_on: dashboard-perfection infrastructure (tokens, motion, icons, i18n) landed in Wave 1-5
supersedes_axes: 10b (partial), 10c (full), 10d (full) of dashboard-perfection
inspiration: https://github.com/hmenzagh/CCMeter
progress: 0%
---

# EPIC: Session Cockpit — Make the Session Detail page look like CCMeter, not a stale demo

> **Status:** 📝 **PROPOSAL — not activated.** Phase 2 is not live.
> This epic exists to correct a delivery gap: the `dashboard-perfection`
> epic claims axes 10b / 10c / 10d are complete (issues 003, 004, 005).
> Live screenshots taken 2026-04-20 on session `b17c519…1c2640`
> show the pre-epic visual baseline is still rendering. Infrastructure
> landed, wiring did not.

## Why a new epic

Three PRs (#2024, #2025, #2026) closed "done" with matching code, tests, and
design tokens. But the Session Detail page in the running build still shows:

- **Terminal tab:** the ASCII-boxed `SESSION TRANSCRIPT` / `LIVE TERMINAL
  OUTPUT` banners, `BYPASSPERMISSIONS` + `ALIVE` + `● IDLE` + "Claude is
  idle" subtitle = four competing status indicators, leaked `[CAVEMAN]`
  mode line, whitespace-collapsed transcript blob.
- **Transcript tab:** no role-colored bubbles, no user message rendered
  (only assistant), no timestamps, no per-bubble actions, no tool-block
  collapse — just one flat markdown blob.
- **Metrics tab:** the six emoji-ish KPI cards are still there; the
  `MESSAGES: 0 / TOOL CALLS: 0` vs `$0.414 · 118,471 tokens` contradiction
  is still there; the `EFFICIENCY` card (explicitly deleted by Axis 10c.7)
  is still there; the token usage bar (explicitly replaced by a table in
  Axis 10c.4) is still a bar; the "No latency samples yet." card is
  still a full card.

Net: the components `SessionMetricsPanel.tsx`, `ClaudeStatusStrip.tsx`,
`SessionStateBadge.tsx`, sanitized stream utility, etc. all exist in
`dashboard/src/components/session/` but are not mounted (or the old
panels are still mounted alongside). This epic rewires the page and
redesigns it using CCMeter as the reference.

## Design north star — CCMeter

[hmenzagh/CCMeter](https://github.com/hmenzagh/CCMeter) is a ratatui
TUI that shows Claude Code usage at a glance. Steal:

1. **KPI banner** — one condensed row: total cost, streak / active days,
   avg tokens/day, efficiency score, model mix. No duplicated numbers below.
2. **Per-model color coding** — Opus / Sonnet / Haiku / GLM / BYO all get
   a distinct accent hue. Sparklines and pie slices inherit that hue.
3. **Heatmap cells with sparkline trend overlay** — minute-level
   granularity for `1H / 12H / Today`, daily for `7D / 14D`.
4. **Quartile gauge** on efficiency (green → yellow → red) with a
   tooltip explaining `tokens / line-of-code` lower-is-better.
5. **Rate-limit tracker** — usage bars for 5h / 7d / Opus / Sonnet
   windows, with an extrapolated "forecast: you'll hit 5h cap in ~41m"
   line when a velocity is available.
6. **Terminal-native aesthetic** — monospace numerics, tight grid,
   minimal chrome, dense cards. Feels like a workstation panel, not a SaaS.

Differences from CCMeter we keep:
- Web, not TUI. Uses Lucide icons and CSS tokens already in the repo.
- Per-session scope first; global `/cost` already has the cross-session
  breakdown.

## Goal

The Session Detail page is the one screen people show in demos. It must:

- parse, not pass-through, the target Claude Code status;
- present one status, one back path, one breadcrumb;
- render the transcript as a real conversation (bubbles, roles, times,
  tool collapses);
- render metrics with a time dimension, model attribution, and cost
  benchmark — every number honest, every unit explicit.

## Exit criteria

- A neutral reviewer opening the page on live data cannot spot:
  - any redundant status indicator,
  - any emoji-headed KPI card,
  - any `EFFICIENCY: —` card,
  - any `MESSAGES: 0` next to `>100 tokens`,
  - any raw ASCII box or leaked shell/tool-bootstrap.
- A Playwright screenshot diff against a CCMeter-inspired reference
  mock agrees within 0.5 % pixel tolerance on a fixed fixture.
- `MESSAGES`, `TOOL CALLS` and `APPROVALS` counts derive from the
  same event source as `TOKENS` — one integration test proves it.
- `prefers-reduced-motion` renders the page with zero animation,
  including the ambient heatmap.

---

## Issue 01 — Mount the sanitized stream and kill the raw passthrough

**Defect (screenshot 1):** the Terminal tab still shows
`┌────SESSION TRANSCRIPT────┐`, `┌────LIVE TERMINAL OUTPUT────┐`,
`[CAVEMAN]`, and whitespace-collapsed wrapped text.
`src/sanitize-stream.ts` and `dashboard/src/utils/sanitizeStream.ts`
both exist with golden fixtures — they are not in the hot path.

| # | Acceptance |
|---|---|
| 1.1 | Terminal tab mounts a single `<TerminalStream>` component reading from a sanitized WS feed. Golden fixture: no `SESSION TRANSCRIPT` / `LIVE TERMINAL OUTPUT` banner, no `[CAVEMAN]`, no bootstrap echo. |
| 1.2 | Server sanitizer runs before WS/SSE emission on Linux / macOS / Windows. Existing fixtures in `src/__tests__/fixture-*-bootstrap.txt` become regression tests. |
| 1.3 | Whitespace-collapse bug fixed: the text `1.Line80:Mermaiddiagramreferences` on screen today is an ANSI-width miscalc. Add a test that asserts preserved single-spaces in wrapped lines. |
| 1.4 | Remove the unused legacy passthrough component once 1.1 lands. Grep gate forbids `TerminalPassthrough` re-introduction. |

## Issue 02 — Collapse Terminal + Transcript into one `Stream` tab

**Defect (screenshots 1 & 2):** Terminal and Transcript are peer tabs
showing semantically-overlapping content. The filter bar
(`thinking / Tools / Results`) lives in both. `1 / 2 messages` appears
on the Terminal tab.

| # | Acceptance |
|---|---|
| 2.1 | One `Stream` tab replaces both. Segmented control: `[ Terminal · Transcript · Split ]`. Default = Split on desktop, Transcript on mobile. |
| 2.2 | Filter chips move out of Terminal and apply only to Transcript. |
| 2.3 | Split view is drag-resizable (20–80 %), uses `@tanstack/react-virtual` for the transcript side. |
| 2.4 | URL carries the view: `/sessions/:id?view=split` — deep-linkable, back-button-safe. |

## Issue 03 — Single status indicator, single back path

**Defect (screenshot 1):** four status indicators on screen at once
(`BYPASSPERMISSIONS` chip, `ALIVE` pill, `● IDLE` WS dot, "Claude is
idle, awaiting input" subtitle). Plus `← Back to Sessions` link
duplicating the global breadcrumb (`Overview / yoyoyoyoyo`).

| # | Acceptance |
|---|---|
| 3.1 | `<SessionStateBadge>` (already exists) is the only status control. Delete the `ALIVE` pill, the `WS LIVE / IDLE` dot, and the grey subtitle. |
| 3.2 | Permission mode (`bypassPermissions` etc.) becomes a small muted chip in the header metadata row, not a primary badge. |
| 3.3 | Delete the custom `← Back to Sessions` link. Global breadcrumb stays. |
| 3.4 | Visual-regression pin covers: idle / working / waiting-for-input / error / compacting. |

## Issue 04 — Metrics tab: rebuild around CCMeter

**Defect (screenshot 3):** emoji KPI cards, `MESSAGES: 0` vs 118K tokens
contradiction, `EFFICIENCY` card with em-dash, token-usage bar instead
of table, "No latency samples yet." as a full card.

Replace the entire tab with the following layout (top-to-bottom, single
column on ≤ 768 px, 12-col grid above):

```
┌──────────────────────────────────────────────────────────────┐
│  KPI BANNER                                                  │
│  $0.414  ·  2m 04s  ·  glm-5.1  ·  7 msg  ·  1 tool  ·  ▇   │
│  (cost) (dur)      (model)    (msgs)  (tools)   (efficiency)│
└──────────────────────────────────────────────────────────────┘

┌────────────── COST ─────────────┐  ┌─────── TOKENS ───────┐
│  $0.414            Sonnet-tier  │  │ Input         116.8K │
│  ↓ 12 % vs this repo p50        │  │ Output          1.7K │
│  Try Haiku → −$0.28             │  │ Cache Create      0  │
│  [sparkline: $ vs time]         │  │ Cache Read    129.7K │
└─────────────────────────────────┘  │  [micro-bar per row] │
                                     └──────────────────────┘

┌─────────── TIMELINE ────────────────────────────────────────┐
│  1H  12H  Today  7D  14D          · messages · tools · appr │
│  [heatmap / sparkline overlay with event dots]              │
└─────────────────────────────────────────────────────────────┘

┌─────── LATENCY ────────┐          ┌────── RATE LIMIT ─────┐
│ Hook        —          │          │ 5h   ▇▇▇▇░░░ 61 %     │
│ Permission  —          │          │ 7d   ▇░░░░░░  9 %     │
│ WS         42ms        │          │ Sonnet ▇▇▇░░ 38 %     │
│ (Waiting for samples…) │          │ Forecast: 5h in ~41m  │
└────────────────────────┘          └───────────────────────┘
```

| # | Acceptance |
|---|---|
| 4.1 | **Kill the six KPI cards.** Replace with a single KPI banner (8 condensed values, one row, tabular-nums, muted labels above numerals). |
| 4.2 | **Fix the count contradiction.** `MESSAGES`, `TOOL CALLS`, `APPROVALS` read from the same event stream that feeds `TOKENS`. Integration test: emit N transcript events → banner shows N. |
| 4.3 | **Delete the `EFFICIENCY` card** in its current form. Efficiency is a small `▇▇▇░░` quartile gauge in the banner with a tooltip (`tokens / LoC — lower is better`). |
| 4.4 | **Cost hero** with benchmark: big `$0.414`, delta vs this repo's p50, model name with its accent color, "Try cheaper model" link when a cheaper model is plausibly viable. |
| 4.5 | **Tokens = table, not bar.** Rows: Input / Output / Cache Create / Cache Read. Each row has a micro-bar sized against the row max. Tabular-nums. |
| 4.6 | **Timeline widget.** Activity heatmap with sparkline overlay; time-range switcher `1H / 12H / Today / 7D / 14D`. Drag to scrub → transcript scroll-syncs (shared with issue 05). |
| 4.7 | **Latency collapses** to a single line `Waiting for samples…` when empty, not a full card. When populated: `Hook · Permission · WS` as a 3-row mini-table. |
| 4.8 | **Rate-limit card** with Opus / Sonnet / 5h / 7d usage bars sourced from `x-ratelimit-*` headers on the model endpoint. Feature-flag `VITE_ENABLE_RATE_LIMIT_CARD` for models that don't expose headers. |
| 4.9 | **Per-model accent colors.** Token bar rows, sparklines, and pie slices inherit the model's accent. Color map in `design/tokens.ts`. |
| 4.10 | **All numbers live-tween** on change (integrates with `<AnimatedNumber>`). Respects `prefers-reduced-motion`. |

## Issue 05 — Transcript tab: real bubbles, real times, real actions

**Defect (screenshot 2):** one flat block. No user message, no role
separation, no timestamps, no per-bubble actions.

| # | Acceptance |
|---|---|
| 5.1 | **User message renders.** Current bug: the "Review my REDME…" prompt does not appear. Fix the event source so the user-side lines come through. |
| 5.2 | **Role-colored bubbles** (user / assistant / tool-call / tool-result / system). Tool-call and tool-result are collapsed by default with a chevron. |
| 5.3 | **Timestamps** — absolute in a left margin (tabular, monospace, muted), relative on hover. |
| 5.4 | **Per-bubble actions** on hover: copy, copy markdown up-to-here, permalink. |
| 5.5 | **Scroll-sync** with the Metrics timeline scrubber (issue 4.6). Dragging the scrubber scrolls the transcript to the matching bubble. |
| 5.6 | **Keyboard nav** `j/k` between bubbles; `c` copies the focused bubble. |
| 5.7 | **Empty-first-minute coach** under the composer if `messages.length === 0`: `Press ⌘↵ to send · /model · /bash` with auto-fill chips. |

## Issue 06 — Composer: docked, toolbar, keyboard

**Defect:** composer floats detached below the metrics panel, tools
(Insert/Run Slash, Bash, Review, Screenshot, Interrupt, Escape) crammed
as pill buttons.

| # | Acceptance |
|---|---|
| 6.1 | Composer docks directly under the Stream tab with a 1 px connector. |
| 6.2 | Slash / bash / screenshot / escape / ctrl-c become icon-only toolbar buttons with tooltips (Lucide 16 px, from `<Icon>`). |
| 6.3 | `⌘↵` sends, `↑` recalls last, `Esc` focuses terminal. Hint row under the input on focus. |
| 6.4 | On mobile (≤ 768 px): the toolbar scrolls horizontally; `⌘↵` becomes a large send FAB. |

## Issue 07 — Data contract: one event stream to rule them all

**Root cause of the count contradiction:** two code paths — one populates
the Metrics counts, one populates the Transcript bubbles — read different
sources. One misses user-side events, the other misses tool events.

| # | Acceptance |
|---|---|
| 7.1 | `useSessionEvents(sessionId)` hook is the single source for bubbles, counts, and timeline. Zustand store `useSessionEventsStore`. |
| 7.2 | Counts (`messages`, `toolCalls`, `approvals`, `autoApprovals`, `statusChanges`) are derived selectors over the same event array. |
| 7.3 | Tokens + cost derive from the same events (or from a parallel `usage` stream, but the association is explicit, not implicit). |
| 7.4 | Integration test: push 5 user + 3 assistant + 2 tool events; assert banner shows `MESSAGES 8 · TOOL CALLS 2` and transcript renders 10 bubbles with 2 collapsed tool blocks. |

## Issue 08 — Visual regression, cross-browser, reduced-motion

| # | Acceptance |
|---|---|
| 8.1 | Playwright screenshot pins: Terminal / Transcript / Split × dark / light × 390 px / 768 px / 1440 px = 18 pins. |
| 8.2 | CCMeter-inspired reference mock checked in at `dashboard/e2e/fixtures/session-cockpit.png`; test asserts ≤ 0.5 % pixel diff on the Metrics tab with a fixed event fixture. |
| 8.3 | Reduced-motion test: mount the page with `prefers-reduced-motion: reduce`; no `@keyframes` selector matches, no transform transitions > 0 ms. |
| 8.4 | axe violations = 0 on all three tabs, dark + light. |

---

## Out of scope

- No new endpoints beyond what already exists. The rate-limit card is
  feature-flagged because `x-ratelimit-*` headers are endpoint-dependent.
- No `AEGIS_DASHBOARD_V2` flag. This epic replaces in place — there was
  no rollback cost observed for the prior epic.
- Global cost view at `/cost` is already shipped (dashboard-perfection #008);
  do not duplicate it here.
- No new tokens. Uses `design/tokens.ts` and `design/motion.ts`.

## Dependencies

Already landed (verified 2026-04-20):

- `dashboard/src/components/Icon.tsx`, `StatusDot.tsx`, `<AnimatedNumber>`
- `dashboard/src/design/tokens.ts` + `motion.ts`
- `dashboard/src/utils/sanitizeStream.ts` + `src/sanitize-stream.ts`
- `dashboard/src/components/session/SessionStateBadge.tsx`,
  `ClaudeStatusStrip.tsx`, `SessionHeader.tsx`
- `dashboard/src/i18n/en.ts` — extend with new Metrics copy

## Deliverables

1. Rewired `dashboard/src/pages/SessionDetailPage.tsx` (no new file).
2. Rebuilt `dashboard/src/components/session/SessionMetricsPanel.tsx`
   to the CCMeter layout.
3. New `dashboard/src/hooks/useSessionEvents.ts` with a single-source
   store.
4. New Playwright spec `dashboard/e2e/session-cockpit.spec.ts`.
5. One reference screenshot at `dashboard/e2e/fixtures/session-cockpit.png`.
6. Before/after screenshot set at
   `docs/dashboard/screenshots/session-cockpit/`.

## Success metrics

- Zero of the 9 screenshot defects listed above reproduce on a fresh
  build.
- Lighthouse unchanged or better on the Session Detail route.
- Every number on the Metrics tab has a source-of-truth test.

## Activation

Do not open GitHub issues for this epic until:

1. Maintainer confirms the `dashboard-perfection` Session tab axes
   (10b / 10c / 10d) are to be re-opened rather than treated as done.
2. Phase 2 is marked `status: active`.

Until then this file is specification only.

## Issue map

| # | Title | Priority |
|---|---|---|
| 01 | Mount sanitized stream, kill raw passthrough | P0 |
| 02 | Collapse Terminal + Transcript into `Stream` tab | P0 |
| 03 | Single status indicator, single back path | P0 |
| 04 | Metrics tab rebuild (CCMeter-inspired) | P0 |
| 05 | Transcript bubbles, times, actions | P0 |
| 06 | Composer dock + toolbar | P1 |
| 07 | One event stream for counts + bubbles + timeline | P0 |
| 08 | Visual regression + reduced-motion | P1 |

## Recommended execution order

1. **07** first — fixes the correctness bug; everything else reads from it.
2. **01** and **03** in parallel — cheap wins, unblock visual tests.
3. **02** and **04** in parallel — the two big rebuilds.
4. **05** after 07 and 02 land.
5. **06** and **08** last.

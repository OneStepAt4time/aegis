# Aegis — Command Center Design System

> The control plane of Claude Code. This is the brand contract every agent and
> contributor reads before touching the dashboard. One source of truth.

**DNA:** NASA/SpaceX mission control (deep-space navy, amber telemetry, cyan
health, monospace data, alert hierarchy, "readable at 3 m in low light by
someone who hasn't slept in 18 hours") + Linear-grade craft (Inter 510
signature weight, aggressive negative letter-spacing at display, ultra-thin
semi-transparent borders, keyboard-first density).

**North star:** Aegis is a **command center for an agent fleet** — not a SaaS
dashboard. Every screen should feel like a console you trust to fly 100 agents
unsupervised: dense, calm, unambiguous, fast. Amber-on-navy is the signature.
Distinctive > fashionable.

---

## 1. Color

All tokens are CSS variables in `dashboard/src/index.css` `@theme`. Hex is
authoritative; Tailwind utilities derive from them.

### Surface palette (the canvas)

| Token | Hex | Role |
|-------|-----|------|
| `--color-void` | `#0B1120` | Page canvas — deep-space navy |
| `--color-void-deep` | `#060912` | App shell / off-screen depth |
| `--color-surface` / `--color-void-dark` | `#111827` | Panels, cards, elevated areas |
| `--color-surface-hover` / `--color-void-light` | `#1A2535` | Interactive surface hover |
| `--color-surface-active` | `#1E3A5F` | Selected / active panel |
| `--color-border` / `--color-void-lighter` | `#1E3A5F` | Panel dividers, grid lines |
| `--color-border-subtle` | `#162035` | Inner dividers, minor separation |

Rule: surfaces step up in luminance, never in hue. No blue-tinted "SaaS
slate" — backgrounds are warm-neutral navy.

### Data palette (telemetry values)

| Token | Hex | Role |
|-------|-----|------|
| `--color-accent` | `#FFB800` | **Primary telemetry / brand amber** — key metrics, CTAs, brand mark |
| `--color-accent-cyan` | `#00D4FF` | Healthy / active / links — agent "alive" signal |
| `--color-danger` | `#FF4757` | Critical alert, error, killed |
| `--color-warning` | `#FF9F43` | Degraded / stalled / awaiting approval |
| `--color-success` | `#26DE81` | Nominal / completed |
| `--color-info` | `#3B82F6` | Informational / neutral event |

Amber is the signature. It appears on CTAs, the primary metric in any readout,
the brand mark, and the focus ring. Cyan is the "system nominal" color. The two
together (amber value + cyan status dot) is the Aegis motif — use it.

All data colors on `#111827` must pass WCAG AA (≥ 4.5:1).

### Text

| Token | Hex | Role |
|-------|-----|------|
| `--color-text-primary` | `#E8F0FE` | Primary readable text (cool white, not pure) |
| `--color-text-muted` | `#8BA3C7` | Labels, secondary copy |
| `--color-placeholder` | `#4A6080` | Timestamps, metadata, placeholders |

### CTA

| Token | Value | Role |
|-------|-------|------|
| `--color-cta-bg` | `--color-accent` (`#FFB800`) | Primary action — "launch / approve" |
| `--color-cta-text` | `--color-void` (`#0B1120`) | High-contrast navy on amber |
| `--color-cta-bg-hover` | `#FFC933` | Amber hover |

Secondary actions are ghost: `rgba(255,255,255,0.04)` bg, `--color-border`
1px, `--color-text-primary` text.

### Forbidden
- Purple/violet accent (`#8b5cf6`) — retire it. Aegis is amber + cyan.
- Gradients on surfaces. Depth comes from luminance steps + 1px borders, not
  gradients. (A single subtle amber→transparent glow on the active CTA is the
  only allowed gradient.)
- Pure black (`#000`) or pure white (`#fff`) as surfaces.

---

## 2. Typography

**Inter** (replaces DM Sans) as UI/type, **JetBrains Mono** for all data.

```
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
```

Enable Inter OpenType features globally: `font-feature-settings: "cv01", "ss03", "cv11"`.
Signature weight is **510** (between regular and medium) — the Aegis UI weight.

### Scale (display uses negative letter-spacing; data uses mono)

| Role | Family / weight | Size / line-height | Letter-spacing |
|------|-----------------|--------------------|----------------|
| Display (hero, page title) | Inter 590 | 40–56px / 1.05 | -1.5px |
| H1 page | Inter 590 | 28px / 1.15 | -0.8px |
| H2 section | Inter 590 | 20px / 1.2 | -0.4px |
| Body | Inter 510 | 14px / 1.5 | 0 |
| Label / UI | Inter 510 | 13px / 1.4 | 0 |
| Caption / meta | Inter 450 | 12px / 1.4 | +0.1px (uppercase labels only) |
| **Telemetry value** | JetBrains Mono 500 | 13–28px | 0 |
| **Status / timestamp / ID** | JetBrains Mono 400 | 12–13px | 0 |

**Rule:** every number a user reads as "a reading" — metric, token count,
duration, latency, cost, session ID, timestamp — is **JetBrains Mono**. Text
prose is Inter. If it's a value, it's mono. This single rule does more for the
"command center" feel than any color change.

Uppercase labels (section headers, table column heads, KPI captions) use
`text-transform: uppercase; letter-spacing: +0.08em; font-size: 11px;
font-weight: 590; color: --color-text-muted`.

---

## 3. Spacing, radius, borders, depth

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 px. Cards pad 16–24.
- **Radius:** 6px controls, 10px cards, 14px panels/modals. **Not** pill-round
  (except status dots and the command-palette input). 6–14px reads
  "engineered", not "consumer".
- **Borders:** 1px `--color-border` (`#1E3A5F`) default;
  `--color-border-subtle` (`#162035`) for inner divisions. Mission-control
  grids are visible structure — don't hide borders, celebrate them at 1px.
- **Shadow / depth:** prefer 1px border + one luminance step over blur shadows.
  Elevated surfaces (modals, popovers): `0 0 0 1px #1E3A5F, 0 8px 24px rgba(0,0,0,0.5)`.
- **Grid lines:** tables and telemetry grids show 1px `--color-border-subtle`
  row dividers. No zebra striping — dividers carry it.

---

## 4. Signature components

### Status dot + telemetry pair (the motif)
Every agent/session/metric pairs a **cyan/amber/red dot** with a **mono value**:
`● idle   2.3k tok` — dot encodes state, mono value is the reading, Inter label
names it. This pair repeats everywhere (session row, KPI, header, badge).

### Status color map (single source — reuse everywhere)
| State | Dot/text | Hex |
|-------|----------|-----|
| idle / ready | cyan | `#00D4FF` |
| working / running | amber (pulsing) | `#FFB800` |
| waiting_for_input / awaiting_approval | warning | `#FF9F43` |
| permission_prompt | warning | `#FF9F43` |
| completed / nominal | success | `#26DE81` |
| error / crashed / killed | danger | `#FF4757` |
| stalled | warning (slow pulse) | `#FF9F43` |
| unknown | text-muted | `#4A6080` |

### KPI / telemetry card
`#111827` surface, 1px `#1E3A5F` border, 16px pad. Top: uppercase Inter 590
11px muted label. Center: huge JetBrains Mono value (amber if primary, else
text-primary). Bottom: delta + sparkline (cyan). No icon unless it earns it.

### Data table (session list)
1px row dividers `#162035`, header row uppercase 11px muted on `#0B1120`.
Status = dot+label. IDs/timestamps/tokens = mono. Hover row = `#1A2535`.
Active row = left 2px amber border + `#1A2535`. Dense: 36–40px row height.

### Command palette (⌘K)
Full-width-minus-margins overlay, `#0F172A`, 1px `#1E3A5F`, 14px radius.
Input: Inter, 18px, placeholder muted. Results: mono for session IDs / hotkeys,
Inter for labels. Selected row: `--color-surface-active` + 2px amber left bar.

### Primary CTA
Amber bg, navy text, Inter 590 13px, 6px radius, 1px amber-hover border.
Reserved for the single most important action on the screen (Launch session,
Approve). Never two amber CTAs in one viewport.

### Approval / permission toast
Border-left 3px `--color-warning`. `#111827` surface. Mono session ID +
Inter tool name. Actions: Approve (amber CTA) / Reject (ghost danger).

---

## 5. Motion

- Status transitions are calm: dot color crossfade 150ms ease.
- "working" agent dot pulses amber (opacity 1→0.4→1, 1.6s) — the only ambient
  motion on a static screen. It signals "the system is alive".
- No bounce, no spring, no parallax on data. Motion conveys state, never
  decoration.
- Loading = a 1px amber top-progress bar (indeterminate), not a spinner, for
  full-page loads. Skeletons for content.

---

## 6. Voice & copy

Operator-console voice. Terse, declarative, no marketing words.
- "3 agents running · 2 awaiting approval" not "You have agents working!"
- Statuses lowercase: `idle`, `working`, `awaiting approval`.
- Numbers always paired with units: `2.3k tok`, `412 ms`, `$0.42`.
- Empty states name the next action: "No sessions — press ⌘N to launch."

---

## 7. Redesign slices (ordered — each is one aegis-driven PR)

Each slice is bounded enough for a single Claude Code session (via aegis,
`permissionMode: acceptEdits`) to execute against this DESIGN.md. Verify gate
+ visual before merging.

1. **Tokens + fonts.** Rewrite `src/index.css` `@theme` to the palette/type
   above. Add `@fontsource/inter/latin.css`, retire DM Sans + purple. Map
   every renamed token so existing utilities resolve. (Foundation — everything
   else depends on this.)
2. **Status system.** Centralize the status→color map (§4) into one module
   (`utils/statusStyles` or similar); replace the scattered `--color-dot-*`
   ad-hoc usage across components with it. Touches: SessionTable, StallBadge,
   SessionMobileCard, status pills everywhere.
3. **Mono-for-values sweep.** Find every numeric reading (tokens, ms, cost, IDs,
   timestamps) rendered in Inter and switch to `--font-mono`. Mechanical,
   high-impact.
4. **KPI / telemetry cards.** Restyle overview KPI banner + metrics cards to
   the §4 KPI pattern (uppercase label, big mono value, sparkline).
5. **Data tables.** SessionTable + VirtualizedSessionList to the §4 table
   pattern (dividers, active-row amber bar, dense rows).
6. **Command palette + app shell.** Sidebar, header, ⌘K palette to Command
   Center (navy surfaces, amber active, mono hotkeys). Brand mark restyle.
7. **Session detail.** Transcript/terminal chrome, approval toast, the
   "Send continue" composer → console aesthetic.
8. **Page pass.** Remaining pages (Pipelines, Audit, Metrics, Cost, Analytics,
   Templates, Routines, Settings, AuthKeys, Inbox, Activity) — apply tokens,
   cut visual noise, enforce component patterns.
9. **Cuts.** Remove dead/redundant UI, collapse low-value sections, tighten
   information hierarchy. (The "tagli" the brief asks for.)
10. **Polish + a11y.** Focus rings (amber), contrast audit (AA on all
    data-on-surface pairs), keyboard nav, reduced-motion respect, loading
    skeletons.

**Per-slice definition of done:** `npm run build:dashboard` passes; the
slice's touched components render correctly in the running dashboard; a
before/after screenshot is captured; no new `any`/`as`; gate green on CI.

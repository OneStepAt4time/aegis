# Dashboard Perfection Epic — Stato Avanzamento

> Aggiornato: 2026-04-19 (Wave 5 completata — Epic DONE ✅)
> Epic: `.claude/epics/dashboard-perfection/epic.md`
> Epic GitHub issue: [#2044](https://github.com/OneStepAt4time/aegis/issues/2044)
> Stato epic: `proposal` — gated on Phase 2 activation
> Rating iniziale dashboard: **6.5/10** | Obiettivo: **12/10** ✅

---

## Panoramica

22 issue (001–022) su 15 assi tematici per trasformare la dashboard Aegis da
"funzionale ma grezza" a livello produzione. Lavoro suddiviso in **onde** (wave)
con dipendenze esplicite.

---

## Wave 1 — Fondazioni (Completata ✅)

4 agenti in parallelo, tutti completati, integrati nel branch di staging
`integrate/dash-wave1`. **Non ancora pushati su remote.**

### 016 — Design Tokens ([#2037](https://github.com/OneStepAt4time/aegis/issues/2037) ✅ closed)
- **Branch:** `feat/dash-016-design-tokens`
- **Cosa fatto:**
  - `dashboard/src/design/tokens.ts` (~165 LOC) — sorgente di verità per colori,
    spacing, radius, duration, easing, shadow, z-index
  - `dashboard/src/design/motion.ts` (~55 LOC) — preset Framer Motion
  - `scripts/dashboard-tokens-gate.cjs` (~200 LOC) — scanner zero-dep che flagga
    hex/rgb/hsl/cubic-bezier hardcoded nei componenti
  - `scripts/dashboard-tokens-gate.allowlist.txt` — 27 file allowlistati per
    migrazione graduale
  - `docs/dashboard/design-tokens.md` — documentazione
  - Token CSS custom properties aggiunti a `index.css`
  - Script `dashboard:tokens:gate` wired nel `gate` chain
- **Gate stats:** 135 violazioni su 27 file (55 scansionati); allowlist seeded

### 020 — Icon Primitive ([#2041](https://github.com/OneStepAt4time/aegis/issues/2041) ✅ closed)
- **Branch:** `feat/dash-020-icon-primitive`
- **Cosa fatto:**
  - `dashboard/src/components/Icon.tsx` (70 LOC) — wrapper Lucide tipizzato:
    `IconName = keyof typeof Lucide`, scale `12|16|20|24`, aria contract
  - `dashboard/src/components/StatusDot.tsx` (64 LOC) — dot animato con varianti
    `idle | working | waiting | error | compacting | unknown`
  - 6 unit test (Icon.test.tsx)
  - `scripts/dashboard-icons-audit.cjs` — reporter per glyph non-ASCII
  - **Bug fix:** eliminato `lucide-react.d.ts` stub che shadowava i tipi reali
    come `any`
- **Audit:** 73 file scansionati, 8 file con 12 glyph da migrare

### 022 — Users Page Redirect ([#2043](https://github.com/OneStepAt4time/aegis/issues/2043) ✅ closed)
- **Branch:** `feat/dash-022-users-redirect`
- **Cosa fatto:**
  - `/users` route → client-side redirect a `/auth/keys`
  - Nav entry "Users" rimosso (7 item rimasti)
  - Banner dismissibile su `/auth/keys` quando arrivi da redirect:
    "Users are API keys in single-tenant mode"
  - Entry rimosso anche dalla Command Palette
  - `UsersPage.tsx` diventato stub redirector (20 LOC)
  - Test: redirect test + 3 test banner

### 003a — Stream Sanitation (Client) (merged into [#2024](https://github.com/OneStepAt4time/aegis/issues/2024) ✅)
- **Branch:** `feat/dash-003a-stream-sanitation`
- **Cosa fatto:**
  - `dashboard/src/utils/sanitizeStream.ts` (353 LOC) — funzione pura che
    ripulisce output terminale:
    - Shell bootstrap (PowerShell + Unix)
    - Hooks path temporanei
    - Claude ASCII logo
    - Status footer (`· Frolicking…`, `esc to interrupt…`)
    - Code fence protection (contenuto dentro ```…``` preservato)
  - Integrato in `TerminalPassthrough.tsx`
  - 29 test con fixture golden
- **Risultato visivo:** terminale sessione drammaticamente più pulito

### Verifica Staging
- **Branch:** `integrate/dash-wave1` (merge pulito, zero conflitti)
- Typecheck: ✅ | Test: **427/427** pass (2 skipped) | Build: 656ms | Tokens gate: 12ms ✅
- Verifica visiva su porta 9101: redirect ✅, nav ✅, terminale pulito ✅

---

## Wave 2 — UI/UX Core (Completata ✅)

4 agenti in parallelo, tutti completati e integrati nel branch `integrate/dash-wave2`.
Fix post-integrazione: rimosso import `AlertCircle` inutilizzato in `ErrorState.tsx` (TS6133).
**Gate finale: ✅ 3192 test pass, build pulita, `npm run gate` green.**

| Issue | Branch | GH Issue | Stato |
|-------|--------|----------|-------|
| 002 — Light Mode Overhaul | `feat/dash-002-light-mode` | [#2023](https://github.com/OneStepAt4time/aegis/issues/2023) | ✅ closed |
| 004 — Session Metrics Tab | `feat/dash-004-session-metrics` | [#2025](https://github.com/OneStepAt4time/aegis/issues/2025) | ✅ closed |
| 006 — Session History | `feat/dash-006-session-history` | [#2027](https://github.com/OneStepAt4time/aegis/issues/2027) | ✅ closed |
| 018 — Error & Feedback States | `feat/dash-018-error-states` | [#2039](https://github.com/OneStepAt4time/aegis/issues/2039) | ✅ closed |

### 002 — Light Mode Overhaul ([#2023](https://github.com/OneStepAt4time/aegis/issues/2023) ✅)
- `useTheme.ts`: supports `'dark'|'light'|'light-paper'|'light-aaa'|'auto'`, `resolvedTheme`, `systemPref`
- `Layout.tsx`: wordmark/nav use CSS var tokens + `dark:` guards
- `SettingsPage.tsx`: light variant picker (Default/Paper/AAA) + auto-theme checkbox
- `CreateSessionModal.tsx`, `EmptyState.tsx`: CTA/icon use token vars

### 004 — Session Metrics Tab ([#2025](https://github.com/OneStepAt4time/aegis/issues/2025) ✅)
- `SessionMetricsPanel.tsx`: cost hero, token table (Input/Output/Cache rows + micro-bars), Lucide `<Icon>`
- `LatencyPanel.tsx`: Hook · Permission · WS row, "Waiting for samples…" skeleton

### 006 — Session History ([#2027](https://github.com/OneStepAt4time/aegis/issues/2027) ✅)
- `SessionHistoryPage.tsx`: clickable rows, ChevronRight, keyboard nav (↑↓/Enter), Name column
- Short Session ID with copy-on-hover, bulk action bar (Export/Kill/Share/Clear)
- URL state via `useSearchParams`, date range options, relative timestamps

### 018 — Error & Feedback States ([#2039](https://github.com/OneStepAt4time/aegis/issues/2039) ✅)
- `ErrorState.tsx` (NEW): 6 variants (offline/server-5xx/unauthorized/rate-limited/timeout/not-found)
- `ConnectionBanner.tsx` (NEW): animated retry countdown, auto-dismiss, `aria-live="polite"`
- `ToastContainer.tsx`: CSS vars, hover-pause, 6s auto-dismiss, max 4
- `useOptimistic.ts` (NEW): optimistic UI hook with rollback
- `Skeleton.tsx` extended: SessionRow / StatCard / DetailHeader
- 33 new tests (ErrorState 17, ConnectionBanner 6, useOptimistic 10)

### Verifica Staging
- **Branch:** `integrate/dash-wave2` (all 4 feat branches merged, zero conflicts)
- Typecheck: ✅ | Test: **3192/3207** pass (15 skipped) | Build: ✅ | Gate: ✅
- Worktree: `D:\aegis\.claude\worktrees\dash-wave2-staging`

---

## Wave 3 — IA & Interaction (Completata ✅)

4 agenti in parallelo (con retry per errore 401 modello), tutti completati e integrati nel branch `integrate/dash-wave3`.
Fix post-integrazione: rimossi hex fallback da `var()` calls, fixata violazione `clickable-gate` su `NewSessionPage`.
**Gate finale: ✅ 3229 test pass, build pulita, `npm run gate` green.**

| Issue | Branch | GH Issue | Stato |
|-------|--------|----------|-------|
| 001 — IA Refactor | `feat/dash-001-ia-refactor` | [#2022](https://github.com/OneStepAt4time/aegis/issues/2022) | ✅ closed |
| 003 — Session Detail | `feat/dash-003-session-detail` | [#2024](https://github.com/OneStepAt4time/aegis/issues/2024) | ✅ closed |
| 011 — Interaction Patterns | `feat/dash-011-interaction` | [#2032](https://github.com/OneStepAt4time/aegis/issues/2032) | ✅ closed |
| 012 — Accessibility | `feat/dash-012-a11y` | [#2033](https://github.com/OneStepAt4time/aegis/issues/2033) | ✅ closed |

### 001 — IA Refactor ([#2022](https://github.com/OneStepAt4time/aegis/issues/2022) ✅)
- Nav ridotto a 5 item in 2 gruppi: WORKSPACE (Overview · Sessions · Pipelines) / ADMIN (Audit · Auth Keys)
- `New Session` rimosso da nav; entry points: ⌘N, header button, "Fork" su session detail
- `/sessions/new` → right-side drawer 480px via `NewSessionDrawer` + Zustand `useDrawerStore`
- `/users` → redirect `/auth/keys` con banner "Users are API keys in single-tenant mode"
- Session History merged in Sessions con tab Active / All; `/sessions/history` redirects
- Audit Trail rinominato Audit
- `dashboard:clickable:gate` script aggiunto al gate chain
- CommandPalette aggiornata con nuova IA

### 003 — Session Detail ([#2024](https://github.com/OneStepAt4time/aegis/issues/2024) ✅)
- Stream sanitation server-side: strip bootstrap PS/bash, ASCII logo Claude, hooks echoes
- Golden fixtures per Linux / macOS / Windows bootstrap patterns
- `ClaudeStatusStrip`: versione · modello · effort chip · thinking dot
- `SessionStateBadge`: consolida ALIVE pill + Idle dot + WS LIVE/IDLE in un unico badge
- Rimossi back-link custom e mini-breadcrumb; solo global breadcrumb
- Kill → overflow `…` menu con hold-to-confirm 800ms; Save as Template + Fork nello stesso menu
- Filter chips: filled-accent (attivi) / outlined-muted (inattivi) + count badge
- Composer dockato sotto terminale con toolbar (slash/bash/screenshot/esc/ctrl-c)
- First-minute coach con tip ⌘↵ + 3 slash command auto-fill
- Full-bleed `F` toggle preservato

### 011 — Interaction Patterns ([#2032](https://github.com/OneStepAt4time/aegis/issues/2032) ✅)
- `CopyButton`: copy icon on hover + hotkey `c` quando focused; applicato a Session ID, Auth Key ID, workDir, owner key
- `useDestructive()` hook: toast 5s con Undo, azione server dopo timeout
- `ConfirmDestructive`: hold-button 800ms oppure typed confirmation (match nome entità)
- `NLFilterBar`: parsing "failed sessions from yesterday by master" → chip removibili + fallback full-text
- `useRecentDirs`: localStorage `aegis:recent-dirs:v1`, star/unstar, recent dirs su New Session form
- 14 unit test NL parser + Playwright e2e (copy hotkey, hold-to-confirm, NL→chips)

### 012 — Accessibility ([#2033](https://github.com/OneStepAt4time/aegis/issues/2033) ✅)
- Token CSS `--focus-ring` + `--focus-ring-offset` in `@theme`; regola globale `:focus-visible`
- Media query blocks: `prefers-reduced-motion`, `prefers-reduced-transparency`, `forced-colors`, `prefers-contrast: more`
- `aria-live` su SessionHeader status region e AuditPage tbody
- CommandPalette: `role="combobox/listbox/option"`, `aria-activedescendant`, nav frecce
- Skip-to-content link in Layout.tsx
- axe-core + Playwright a11y e2e per 6 route × 2 theme
- Script standalone `npm run dashboard:a11y:check`

### Verifica Staging
- **Branch:** `integrate/dash-wave3` (4 feat branches merged, 1 conflitto risolto in SessionHeader.tsx)
- Typecheck: ✅ | Test: **3229/3244** pass (15 skipped) | Build: ✅ | Gate: ✅
- Worktree: `D:\aegis\.claude\worktrees\dash-wave3-staging`

---

## Wave 4 — Stream, Cost, Typography, Motion (Completata ✅)

5 agenti in parallelo, tutti completati, integrati in `integrate/dash-wave4`.

### 005 — Transcript Redesign ([#2026](https://github.com/OneStepAt4time/aegis/issues/2026) ✅)
- Terminal + Transcript unificati in un unico **Stream tab** (toggle Terminal / Transcript / Split)
- Bubble per ruolo: User=verde CTA, Assistant=neutro, Tool-call=amber collassato, System=italics muted
- Timestamp assoluto in margine, relativo on hover; azioni per bubble: Copy, Copy-markdown, Permalink
- Navigazione keyboard `j/k`, copia con `c`; virtual scroll (`@tanstack/react-virtual`); empty state branded
- Split view resizable (drag handle, 20–80%); espone callback `onSeek` per scrubber 008

### 007 — Overview Split ([#2028](https://github.com/OneStepAt4time/aegis/issues/2028) ✅)
- Overview ridotta a 1 viewport: health row + top-5 sessioni + CTA New Session
- Nuova route `/activity` con audit stream live + operational metrics
- "Agent Standby Mode" hero condizionale (solo `totalSessions===0 AND activeSessions===0`)
- Rimossi contatori Active Sessions duplicati; code sample → `ag create "brief"`
- Command palette: voce "Live activity" → `/activity`

### 008 — Cost/Time ([#2029](https://github.com/OneStepAt4time/aegis/issues/2029) ✅)
- Route `/cost`: bar chart 14-day, pie per modello, burn rate + projection (Recharts)
- `TimelineScrubber` in SessionHeader: activity plot, drag/keyboard/touch seek, callback `onSeek`
- `SparklineCard` per stat cards Overview (7-day trend, hover value)
- Budget settings: daily/monthly cap, toast warning 80%, LocalStorage persistence
- Command palette: "Cost & Billing" → `/cost`; sidebar nav "OPERATIONS"

### 010 — Typography System ([#2031](https://github.com/OneStepAt4time/aegis/issues/2031) ✅)
- Variable WOFF2 (DM Sans + JetBrains Mono) via `@font-face` con `size-adjust` (CLS=0)
- Fluid type scale `--text-xs` → `--text-3xl` con `clamp()` (320→1440px)
- OpenType: `tnum` via `[data-numeric]`, `calt`/`liga` su body, `calt` off su monospace
- `<Code>` shared component (inline/block, `lang` prop)
- Reading font toggle in Settings: Default / Hyperlegible / Dyslexia (Zustand + localStorage)
- Playwright CLS test (< 0.02)

### 017 — Motion System ([#2038](https://github.com/OneStepAt4time/aegis/issues/2038) ✅)
- Token CSS `--duration-*` (instant/fast/base/slow/cinematic) + `--ease-*` in `@theme {}`
- Framer Motion presets aggiornati in `design/motion.ts`
- `<StaggerList>` / `<StaggerItem>` (40ms stagger), `<AnimatedNumber>` (spring + accent flash)
- Theme swap CSS transition su `:root` (320ms cross-fade tutti i custom property)
- Ambient drift: `@keyframes` 60s ≤2% hue, GPU-only, paused con `prefers-reduced-motion`
- Ink-bar tab con Framer Motion `layoutId`; audit rows arrive-in-view (throttle 100ms)
- `HoldButton` ring SVG stroke-dashoffset; Playwright reduced-motion test suite

### Verifica Staging
- **Branch:** `integrate/dash-wave4` (5 feat branches merged, 1 conflitto in App.tsx risolto)
- Lock file aggiornato: recharts + @tanstack/react-virtual
- Typecheck: ✅ | Test: **3229/3244** pass (15 skipped) | Build: ✅ | Gate: ✅
- Worktree: `D:\aegis\.claude\worktrees\dash-wave4-staging`

---

## Wave 5 — Polish & Completion (Completata ✅)

5 agenti in parallelo, tutti completati, integrati in `integrate/dash-wave5`.
Conflitti risolti: index.html (favicon SVG 019 + PWA tags 015), App.tsx (OnboardingScreen + FirstRunTour in sequenza).
Fix post-integrazione: rimosso import `@testing-library/jest-dom` in Typewriter.test.tsx (non installato), sostituito con asserzioni native.
**Gate finale: ✅ 3229 test pass, build pulita, `npm run gate` green.**

### 009 — Dark Mode Polish ([#2030](https://github.com/OneStepAt4time/aegis/issues/2030) ✅ closed)
- **Branch:** `feat/dash-009-dark-mode` | **PR:** [#2056](https://github.com/OneStepAt4time/aegis/pull/2056)
- Display-P3 wide-gamut palette: `@media (color-gamut: p3)` block — CTA green, accent cyan, void bg; graceful sRGB fallback
- View Transitions API: `viewTransitions.ts` utility + `useViewTransitionNavigate` hook; wired into CommandPalette; no-op when unavailable
- CTA gradient sheen: 3s sweeping gradient on primary CTAs; pauses on hover; GPU-accelerated
- Ambient background drift: `will-change: filter`; ≤2% hue drift (4° ≈ 1.1%); 60s cycle
- Audit row shimmer: `.audit-row-new` — 320ms left-to-right accent sweep
- Zero layout shift: all animations use `position:absolute` + `isolation:isolate`
- E2E: `dark-mode-polish.spec.ts`

### 014 — Empty States ([#2035](https://github.com/OneStepAt4time/aegis/issues/2035) ✅ closed)
- **Branch:** `feat/dash-014-empty-states` | **PR:** [#2057](https://github.com/OneStepAt4time/aegis/pull/2057)
- `EmptyState.tsx` primitive: variants `empty / empty-searchable / empty-error / feature-unavailable`
- `FirstRunTour.tsx`: 6-step overlay (welcome → create → permission → approve → kill → complete); Esc skip; `aegis:tour:completed` localStorage
- "Surprise me": 3 demo pipelines + 3 demo sessions; auto-expire 24h via localStorage timestamp
- Context-aware empty hints: AuthKeysPage shows copy-to-clipboard `ag doctor` command
- Idle tips: after 10s idle, rotates tips via Framer Motion `AnimatePresence`; resets on any interaction
- Standby hero fix: only when `totalSessions===0 AND activeSessions===0`

### 015 — Mobile PWA ([#2036](https://github.com/OneStepAt4time/aegis/issues/2036) ✅ closed)
- **Branch:** `feat/dash-015-mobile-pwa` | **PR:** [#2058](https://github.com/OneStepAt4time/aegis/pull/2058)
- `manifest.json` + `sw.js`: cache-first app shell, network-first for `/api/`; registered in `main.tsx`
- PWA meta tags in `index.html`: manifest, theme-color, apple-mobile-web-app-*
- `MobilePermissionPrompt`: swipe-right=approve, swipe-left=reject, long-press=context menu
- Hooks: `useSwipeGesture`, `useHaptics` (navigator.vibrate), `useBiometricAuth` (WebAuthn, feature-flagged), `useOfflineQueue` (localStorage + idempotent UUIDs)
- Mobile regression fix: command palette ⌘K only registers on non-touch devices
- Backdrop fix: solid `bg-[var(--color-void)]` on mobile

### 019 — Brand & Signature Moments ([#2040](https://github.com/OneStepAt4time/aegis/issues/2040) ✅ closed)
- **Branch:** `feat/dash-019-brand` | **PR:** [#2059](https://github.com/OneStepAt4time/aegis/pull/2059)
- `ShieldLogo.tsx`: `ShieldLogoMark` + `ShieldWordmark` (sm/md/lg/xl); CTA green gradient; replaces sidebar emoji
- `OnboardingScreen.tsx`: full-screen first-launch wow — shield scale → wordmark fade → typewriter tagline → CTA; `aegis:onboarded` flag; skip button; chains into FirstRunTour on complete
- `Typewriter.tsx`: character-by-character animation, configurable speed, `onDone` callback
- Confetti burst: `canvas-confetti` on first session create, brand colors; fires once (`aegis:first-session`)
- Voice guide: feature-flagged `VITE_ENABLE_VOICE`; Web Speech API; no audio files
- `/favicon.svg`: shield mark with CTA green gradient on dark circle
- Brand-aware skeleton shimmer: `--color-surface` bg + `--color-cta` tinted sweep

### 021 — i18n Plumbing ([#2042](https://github.com/OneStepAt4time/aegis/issues/2042) ✅ closed)
- **Branch:** `feat/dash-021-i18n` | **PR:** [#2060](https://github.com/OneStepAt4time/aegis/pull/2060)
- `dashboard/src/i18n/en.ts`: 170+ keys, nested by feature area
- `I18nProvider` + `useT()` hook: React Context, parameter substitution, zero external deps
- Format utilities: `formatDate.ts`, `formatNumber.ts`, `formatRelativeTime.ts`, `pluralize.ts` — all via `Intl.*`
- `scripts/i18n-gate.cjs`: prevents inline JSX strings >3 words; `npm run dashboard:i18n:check`
- Settings locale picker: en-US, de-DE, ja-JP, ar-SA; persists `aegis:locale` in localStorage
- RTL audit: logical CSS properties throughout key layout components
- E2E RTL suite + unit tests for all utilities

### Verifica Staging
- **Branch:** `integrate/dash-wave5` | **PR:** [#2061](https://github.com/OneStepAt4time/aegis/pull/2061)
- Conflitti risolti: index.html (favicon + PWA tags), App.tsx (OnboardingScreen + FirstRunTour chain)
- Typecheck: ✅ | Test: **3229/3244** pass (15 skipped) | Build: ✅ | Gate: ✅
- Worktree: `D:\aegis\.claude\worktrees\dash-wave5-staging`

---

## ✅ EPIC COMPLETE — 22/22 Issue Delivered

---

## Non Ancora Iniziate

*Nessuna — tutte le 22 issue sono complete.*

---

## Metriche Complessive

| Metrica | Valore |
|---------|--------|
| Issue totali | 22 |
| Epic GitHub issue | [#2044](https://github.com/OneStepAt4time/aegis/issues/2044) |
| Sub-issue GitHub range | #2022–#2043 |
| **Completate** | **22/22** ✅ |
| Non iniziate | 0 |
| Test totali (wave5 staging) | 3229 pass, 15 skipped (3244 total) |
| LOC aggiunte (wave 1) | ~1.300 |
| LOC aggiunte (wave 2) | ~2.200 |
| LOC aggiunte (wave 3) | ~4.500 est. |
| LOC aggiunte (wave 4) | ~3.500 est. |
| LOC aggiunte (wave 5) | ~4.500 est. |
| Branch pushati su remote | 20 feat + 5 integrate |
| PR aperte | [#2056](https://github.com/OneStepAt4time/aegis/pull/2056) [#2057](https://github.com/OneStepAt4time/aegis/pull/2057) [#2058](https://github.com/OneStepAt4time/aegis/pull/2058) [#2059](https://github.com/OneStepAt4time/aegis/pull/2059) [#2060](https://github.com/OneStepAt4time/aegis/pull/2060) [#2061](https://github.com/OneStepAt4time/aegis/pull/2061) |
| Worktree attivi | 23 |

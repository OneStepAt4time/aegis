# Accessibility

## CI Integration
- `npm run dashboard:a11y:check` — runs axe-core/playwright audit (requires dev server on port 5200)
- Automatic in CI via the `a11y.yml` workflow (future)

## Focus Ring
Single token: `--focus-ring` in `src/index.css`. All interactive elements inherit it via `:focus-visible`.

## Media Queries Supported
- `prefers-reduced-motion: reduce` — all animations paused
- `prefers-reduced-transparency` — translucent backgrounds solidified
- `forced-colors: active` — Windows High Contrast Mode
- `prefers-contrast: more` — muted colours boosted

## Known Limitations
- Voice approvals (Web Speech API) are future work (feature-flagged)
- Screen-reader recordings TBD for each release

## Manual Test Plan
Run with NVDA (Windows) + VoiceOver (macOS) per release:
1. Tab through entire nav — verify landmark announcements
2. Open/close modals — verify focus trap and return
3. Create session — verify form label announcements
4. Session list — verify row navigation

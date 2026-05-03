# Release v0.6.6 — What's New

> _29 issues closed. 3 security hardening fixes. A rate limiter that actually respects you. Route aliases so your SDK doesn't break._

---

## 🚀 Highlights

### API Route Aliases (#2485 — closes #2461, #2459, #2457)

Claude Code and other clients expect certain session endpoints. We added canonical aliases so nothing breaks:

| Alias | Maps to |
|-------|---------|
| `POST /v1/sessions/:id/input` | `POST /v1/sessions/:id/send` |
| `POST /v1/sessions/:id/kill` | `DELETE /v1/sessions/:id` |
| `POST /v1/sessions/:id/terminate` | `DELETE /v1/sessions/:id` |
| `POST /v1/sessions/:id/stop` | `DELETE /v1/sessions/:id` |
| `GET /v1/sessions/:id/stream` | `GET /v1/sessions/:id/events` (SSE) |

All aliases share the same handler as the canonical route — future changes propagate automatically. SSE auth middleware also updated to recognize `/stream` with `?token=` auth.

### Rate Limiter Rewrite (#2484 — closes #2456)

The old rate limiter had a critical flaw: unauthenticated requests from the same IP could exhaust the rate-limit bucket for valid API keys. **Not anymore.**

- **Compound bucket keys** (`ip:keyId`) — authenticated and unauthenticated traffic are fully independent
- **Dedicated unauth bucket** — 30 req/min for requests without a valid token
- **Auth-fail isolation** — failed auth attempts get their own bucket; valid tokens are never blocked by prior failures from the same IP
- **Per-key independence** — each API key gets its own rate-limit bucket per IP

### Pagination Validation (#2481 — closes #2462)

Session list pagination now uses proper Zod schema validation instead of silent `Math.max`/`Math.min` clamping:

- `page=-1` → 422 (was silently clamped to 1)
- `limit=0` → 422 (was silently clamped to 1)
- `limit=999` → 422 with clear error message (was silently capped to 100)

### Notification Workflow Hardening (#2483 — closes #2448)

Discord notification payloads now built with `jq -n --arg` instead of raw heredoc JSON. Eliminates shell/JSON breakage from commit messages, PR titles, and other user-controlled fields.

---

## 🔒 Security

| Issue | Fix |
|-------|-----|
| #2458 — `/v1/health` leaked version, uptime, and Claude version without auth | Health endpoint now requires authentication for sensitive fields |
| #2454 — `timingSafeEqual` length leak in auth and webhook verification | Constant-time comparison hardened |
| #2446 — Grace keys not pruned on key revocation | Revoked keys now fully invalidate immediately |

---

## 🐛 Bug Fixes

### Dashboard

| # | Description |
|---|-------------|
| #2378 | Real-user audit regressions fixed |
| #2383 | First-run tour no longer blocked by New Session drawer backdrop |
| #2388 | Windows paths display correctly; audit columns no longer overflow |
| #2482 | Audit page skeleton loaders no longer persist indefinitely; search placeholder truncated correctly |
| #2352 | Mobile nav drawer is now easy to close and doesn't block actions |
| #2351 | Token login persists across reload and deep links |
| #2350 | Mobile controls have proper touch target sizes |
| #2348 | CSP font errors and `/auth/session` 404 noise eliminated on load |
| #2347 | Session detail terminal streaming works after UI-created sessions |
| #2346 | Onboarding tour no longer intercepts token login sign-in |
| #2345 | Hashed assets now served with immutable cache headers |
| #2364 | Production pages pass axe accessibility audit across core routes |
| #2365 | Form controls have accessible names |
| #2366 | Mobile hit targets sized for real fingers |
| #2367 | Chart containers render with valid dimensions |

### Backend / API

| # | Description |
|---|-------------|
| #2363 | Completed BYO Claude sessions no longer remain in working state |
| #2362 | Claude rate-limit menu now reports correct status |
| #2381 | Sessions stop correctly after completed reply |
| #2384 | CSP blob worker error on session detail page resolved |

### CI / Infrastructure

| # | Description |
|---|-------------|
| #2372 | API contracts typecheck fixed — internal `SessionInfo` now has required fields |
| #2414 | Release workflow hardened against partial preview publishes |
| #2486 | External-PR Discord alert no longer fires on internal PRs |

---

## 📊 By the Numbers

| Metric | Value |
|--------|-------|
| Issues closed this cycle | 29 |
| PRs merged (since last preview) | 5 |
| Security fixes | 3 |
| Dashboard fixes | 15 |
| Backend/API fixes | 4 |
| CI/infra fixes | 3 |
| New route aliases | 5 |
| Test files | 222 |
| Tests passing | 3,872 ✅ |

---

## 📋 In Progress (approved, awaiting CI)

The following fixes are approved and ready to merge once CI flake is resolved:

| PR | Description | Closes |
|----|-------------|--------|
| #2487 | Pagination null totals default to 0 | #2460 |
| #2488 | Duplicate shutdown cleanup removed | #2449 |
| #2489 | QuotaManager periodic sweep for usageLog memory leak | #2452 |
| #2490 | Rate-limit memory optimization — fixed-window counters | #2455 |

---

## 🙏 Contributing

Found something? [Open an issue](https://github.com/OneStepAt4time/aegis/issues) — we triage within 24h.

---

*Full changelog: [v0.6.5-preview.3 → v0.6.6](https://github.com/OneStepAt4time/aegis/compare/v0.6.5-preview.3...v0.6.6)*

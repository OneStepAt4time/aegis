# UAT Report — v0.4.0-alpha (FINAL)

**Date:** 2026-04-11 16:00-18:10 UTC
**Tester:** Hephaestus
**Server:** http://127.0.0.1:9100 (v0.4.0-alpha, uptime ~8h)
**Config:** ~/.aegis/config.json (tmuxSession: "aegis")

---

## Test Suite

| Check | Result | Details |
|-------|--------|---------|
| `npm test` | ❌ **1 FAIL** | 2787 pass, 1 fail, 11 skip |
| Failing test | `server-core-coverage.test.ts:284` | tmux socket `/tmp/tmux-1000/aegis-169235` not found |

### Failing Test Root Cause
Test creates a Fastify server with `tmux -L aegis-<PID>` but the tmux socket never gets created. The test tries to create a real tmux session but the socket doesn't exist.
- **Fix needed:** Mock tmux in this test, or ensure tmux server starts before session creation.
- **Production impact:** NONE — production uses `tmux -L aegis` which works correctly.

---

## API Endpoint UAT

### Core Endpoints

| # | Endpoint | Method | Result | Details |
|---|----------|--------|--------|---------|
| 1 | `/health` | GET | ✅ PASS | v0.4.0-alpha, tmux healthy, 0 active |
| 2 | `/v1/sessions` | GET (auth) | ✅ PASS | Returns session list with pagination |
| 3 | `/v1/sessions` | POST (create) | ✅ PASS | Returns 201 with full session object |
| 4 | `/v1/sessions/:id` | GET (auth) | ✅ PASS | Returns session details |
| 5 | `/v1/sessions/:id` | DELETE | ✅ PASS | Returns `{"ok":true}` |
| 6 | `/v1/metrics` | GET (auth) | ✅ PASS | Returns metrics JSON (uptime, sessions, latency, prompt delivery) |
| 7 | `/v1/pipelines` | GET (auth) | ✅ PASS | Returns empty pipelines array |
| 8 | `/v1/auth/verify` | POST (empty) | ✅ PASS | Returns 400 "Token required" |

### Auth Guard

| # | Endpoint | Method | Result | Details |
|---|----------|--------|--------|---------|
| 9 | `/v1/sessions` (no auth) | GET | ✅ PASS | 401 "Bearer token required" |
| 10 | `/v1/sessions` (no auth) | POST | ✅ PASS | 401 "Bearer token required" |
| 11 | `/v1/pipelines` (no auth) | GET | ✅ PASS | 401 |
| 12 | `/dashboard` | GET | ✅ PASS | 200 (public) |

### Non-existent / Unimplemented

| # | Endpoint | Method | Result | Details |
|---|----------|--------|--------|---------|
| 13 | `/v1/config` | GET | ⚠️ 404 | Not implemented in v0.4.0-alpha |
| 14 | `/v1/hooks` | GET | ⚠️ 404 | Not implemented in v0.4.0-alpha |
| 15 | `/v1/nonexistent` | GET | ⚠️ 401 | Unknown routes return 401 instead of 404 |

### Session Creation (Dogfooding Test)

| Step | Result | Details |
|------|--------|---------|
| Create session (workDir only) | ✅ PASS | `{"name":"uat-test-session","workDir":"/home/bubuntu/projects/aegis"}` |
| Session object returned | ✅ PASS | Has id, windowId, windowName, workDir, ccPid, status |
| tmux window created | ✅ PASS | Window appears in tmux list |
| Delete session | ✅ PASS | Returns `{"ok":true}`, window removed |

### Session Send (Partial)

| Step | Result | Details |
|------|--------|---------|
| POST /send with `message` field | ❌ FAIL | Returns validation error — field may be `prompt` not `message` |

**Note:** Could not complete send/read UAT due to rate limiting triggered by earlier wrong-token attempts.

---

## Rate Limiter Issue

During UAT, the rate limiter was triggered (429 "Too many auth failures"). This happened because:
1. Initial UAT attempts used wrong field names (`workdir` vs `workDir`)
2. Multiple 400/500 responses counted as "auth failures"
3. Rate limiter is too aggressive for legitimate testing

**Finding:** Rate limiter may double-count validation errors as auth failures (related to issue #1645: "RateLimiter double-counts auth failures — lockout fires at 3 attempts instead of 5").

---

## Metrics Snapshot

```json
{
  "uptime": 28969,
  "sessions": {
    "total_created": 307,
    "currently_active": 1,
    "prompt_delivery": {
      "sent": 603,
      "delivered": 598,
      "failed": 5,
      "success_rate": 99
    }
  }
}
```

**Prompt delivery:** 99% success rate (598/603 delivered). 5 failures.

---

## Summary

| Category | Pass | Fail | Not Implemented | Warning |
|----------|------|------|-----------------|---------|
| Test Suite | 2787 tests | 1 test (env issue) | - | - |
| Core API | 8/8 | 0 | 0 | 0 |
| Auth Guard | 4/4 | 0 | 0 | 0 |
| Dogfooding | 3/4 | 1 (send field name) | 0 | 0 |
| Unimplemented | 0 | 0 | 2 (config, hooks) | 1 (404 vs 401) |
| **Total** | **15/16** | **1** | **2** | **1** |

**Overall Assessment:** v0.4.0-alpha is **functional for core use cases** (session CRUD, metrics, auth). 
- 1 test failure is a test environment issue (tmux socket), not a code bug
- 2 endpoints not implemented (`/v1/config`, `/v1/hooks`) — expected
- Rate limiter may be too aggressive (double-counts validation errors as auth failures)
- Session send endpoint needs field name verification (`message` vs `prompt`)
- Unknown routes return 401 instead of 404 (low severity)

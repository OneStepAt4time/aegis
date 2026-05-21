# Multica — Security & Ops Posture Assessment

> Generated 2026-05-22 by Hermes. Source: Multica v0.3.5 source code analysis.

## 1. Branch Protection & CI

### CI Checks (`ci.yml`)
- **Frontend job**: pnpm install → reserved-slugs drift check → turbo build/typecheck/lint/test
- **Backend job**: Go build → DB migrations (Postgres 17 + pgvector) → `go test ./...` with real Postgres and Redis services
- **Installer job**: Shell test scripts on both Ubuntu and macOS
- **Concurrency**: `cancel-in-progress: true` — good, avoids wasted CI minutes on PR updates

### Branch Protection
- ⚠️ **No branch protection config found** in the repository (no `.github/settings.yml`, no `admin.yml`). Must be configured at GitHub org/repo settings level.
- ⚠️ CI only triggers on `push` to `main` and PRs targeting `main`. No visible `develop` branch CI.
- ⚠️ No mandatory review enforcement in CI config.

### Release Pipeline (`release.yml`)
- ✅ **Well-structured**: tag validation (semver regex, dirty tag rejection), tests run before any artifact creation
- ✅ **Multi-arch Docker**: Native builds for amd64/arm64 (no QEMU emulation)
- ✅ **Owner guard**: `if: github.repository_owner == 'multica-ai'` — prevents fork tag pushes from publishing
- ✅ **GoReleaser + Homebrew tap**: Uses separate `HOMEBREW_TAP_GITHUB_TOKEN` secret

---

## 2. Auth Model

### Methods
| Method | Implementation | Notes |
|--------|---------------|-------|
| **Magic Link (Email OTP)** | 6-digit code, 10-min expiry, 60s cooldown per email | Primary method |
| **Google OAuth** | Authorization code flow via `googleapis.com/token` | Optional, configurable |
| **JWT** | HS256 signed, configurable TTL (default 30 days) | Session tokens |
| **PATs** | `mul_` prefix, SHA-256 hashed at rest, expirable, last-used tracking | API/CLI access |
| **Daemon Tokens** | `mdt_` prefix, SHA-256 hashed at rest, expirable | Daemon authentication |

### Security Properties
- ✅ Tokens hashed at rest with SHA-256 before DB storage
- ✅ CSRF protection: HMAC-based double-submit cookie pattern
- ✅ Constant-time comparison for verification codes (`subtle.ConstantTimeCompare`)
- ✅ HttpOnly + Secure + SameSite=Strict cookies
- ✅ Secure cookie flag auto-detected from `FRONTEND_ORIGIN` scheme
- ✅ PAT cache TTL clamped to token expiry
- ⚠️ JWT secret has hardcoded fallback `multica-dev-secret-change-in-production` — if env unset, system runs with known secret
- ⚠️ No JWT rotation mechanism or key ID (kid) support

---

## 3. Secret Handling

- ✅ `.env.example` is comprehensive and well-documented
- ✅ `.gitignore` excludes `.env*` files
- ✅ CloudFront private key loaded from AWS Secrets Manager (primary) or base64 env var (fallback)
- ✅ **`pkg/redact/`**: Actively redacts secrets from agent output — covers AWS keys, PEM keys, GitHub tokens, OpenAI/Anthropic keys, Slack tokens, GitLab PATs, JWTs, connection strings
- ⚠️ SMTP password, Google client secret stored as plain env vars in Docker Compose
- ⚠️ No Docker Secrets or vault integration

---

## 4. RBAC / Permissions

### Roles
- `owner`, `admin`, `member` — workspace-scoped
- Permission checks at handler level — workspace membership required for all workspace resources
- Frontend `packages/core/permissions/rules.ts`: Pure permission functions returning `Decision` objects
- Permission rules mirrored between frontend (optimistic) and backend (authoritative)

### ⚠️ Findings
- No `guest` or `viewer` role
- No fine-grained resource-type permissions (all members can create/edit within ownership scope)

---

## 5. Container Security

### Backend Dockerfile
- ✅ Multi-stage build (golang:1.26-alpine → alpine:3.21)
- ✅ CGO_ENABLED=0 — statically linked
- ✅ `-ldflags "-s -w"` — stripped binaries
- ⚠️ **No explicit `USER` directive** — container runs as root by default

### Web Dockerfile
- ✅ Multi-stage build (node:22-alpine)
- ✅ Dedicated non-root user (nextjs:nodejs, uid 1001)
- ✅ Standalone Next.js output

### Docker Compose
- ✅ All ports bound to `127.0.0.1` with security warning
- ⚠️ Postgres password defaults to `multica`
- ⚠️ `sslmode=disable` on DATABASE_URL

---

## 6. Dependency Management

- Go 1.26.1, pgx/v5, go-redis/v9, golang-jwt/jwt/v5 — all current
- Node: pnpm 10.28.2, Turborepo monorepo
- ✅ `onlyBuiltDependencies: ["esbuild", "electron"]` — limits supply chain risk
- ⚠️ No dependabot or renovate config for automated updates
- ⚠️ No `npm audit` step in CI

---

## 7. Data Storage

- **PostgreSQL 17 + pgvector** — primary data store
- **Redis** — real-time relay, caching, PAT cache, rate limiting
- Migrations via `server/internal/migrations/` + `server/cmd/migrate/`
- ✅ SQL migrations are versioned and ordered
- ✅ DB connection via `pgx` with proper connection pooling

---

## 8. Rate Limiting

- ✅ Webhook rate limiter (`webhook_rate_limiter.go`) — IP-based with configurable window
- ⚠️ No general API rate limiting visible in the middleware layer
- ⚠️ No rate limiting on auth endpoints (login, PAT creation) — potential for brute force

---

## 9. Audit Logging

- ⚠️ **No explicit audit trail**. No audit log table, no structured audit events.
- Activity is tracked via issue comments and status changes, but this is project management activity, not security audit.
- No login history, no admin action logging, no token usage audit trail.

---

## 10. Key Takeaways for Aegis

### Where Multica is Stronger
1. **PAT system with expiry + caching** — Aegis should implement token expiry
2. **CSRF protection** — Aegis is API-only so less critical, but worth noting
3. **Secret redaction in agent output** — Aegis has this for ACP payloads (#3617) but not as comprehensive
4. **Multi-stage Docker builds** — Aegis Dockerfile is simpler

### Where Aegis is Stronger
1. **Audit trail** — Aegis has structured audit logs; Multica has none
2. **RBAC depth** — Aegis has viewer/admin roles + strictRBAC; Multica only has owner/admin/member
3. **Budget enforcement** — Aegis has hard limits; Multica has no enforcement
4. **Branch protection awareness** — Aegis is actively working on this (#3949, #3950); Multica has no visible protection
5. **OTel tracing** — Aegis has distributed tracing; Multica has none

### Security Concerns
1. JWT hardcoded dev secret is a foot-gun
2. Backend container runs as root
3. No API rate limiting on auth endpoints
4. No audit trail at all
5. No automated dependency scanning

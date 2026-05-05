# 02 — Security Review

**Date:** 2026-04-08 | **Scope:** `src/auth.ts`, `src/ssrf.ts`, `src/validation.ts`, `src/permission-evaluator.ts`, `src/permission-guard.ts`, `src/permission-request-manager.ts`, `src/permission-routes.ts`, `src/api-contracts.ts`, `src/hook-settings.ts`, `src/hook.ts`, `src/hooks.ts`, `src/fault-injection.ts`, `src/verification.ts`, `src/path-utils.ts`, `src/file-utils.ts`, `src/safe-json.ts`, `src/logger.ts`, `src/diagnostics.ts`

---

## 1. Authentication Model

### Key Generation & Storage — GOOD

- Keys generated with `randomBytes(32)` prefixed `aegis_` — 256 bits of entropy.
- Only SHA-256 hashes persisted on disk; plaintext returned once at creation time.
- Key store written with `mode: 0o600` and subsequently hardened with `chmod`/`icacls` via `secureFilePermissions()`.

### SSE Token Model — GOOD

- Short-lived (60s), single-use `sse_` tokens with per-key cap of 5 outstanding.
- Mutex correctly serializes concurrent `generateSSEToken`/`validateSSEToken` calls.
- SSE endpoints reject long-lived bearer tokens; callers must exchange first.

### Weaknesses

**[SD-AUTH-01] LOW — Key lookup uses plain `===` on SHA-256 hex strings** (auth.ts). Not timing-safe. Recommend `timingSafeEqual` on hash buffers for defense-in-depth.

**[SD-AUTH-02] LOW — No startup warning when running in no-auth mode.** A misconfigured deployment silently operates open. A conspicuous log warning is needed.

**[SD-AUTH-03] MEDIUM — API keys never expire.** No `expiresAt` field; no rotation workflow; no deprecation period. Compromise of any key grants indefinite access. Recommend adding `expiresAt` to `ApiKey` and rejecting expired keys in `validate()`.

---

## 2. Authorization Gaps

### No RBAC / No Session Ownership — CRITICAL

All authenticated API keys are functionally equivalent. Any key can:
- Approve or reject permission prompts for **any session** regardless of which key created it.
- Kill, send messages to, or read transcripts of any session.
- Create new auth keys.

**[SD-AUTHZ-01] HIGH — No session ownership model.** Key A can approve Key B's pending permission prompts, impersonate Key B's sessions, or kill them. A horizontal privilege escalation in any multi-user scenario. Recommend recording `createdByKeyId` on each session and enforcing it in `approve`/`reject`/`kill` handlers.

**[SD-AUTHZ-02] MEDIUM — Any authenticated key can create and revoke other API keys.** No "admin" vs "regular" key distinction. A compromised regular key can create its own permanent backdoor key.

**[SD-AUTHZ-03] LOW — Hook secret validation is duplicated** in the auth middleware and the route handler. One authoritative location would reduce drift risk.

**[SD-AUTHZ-04] LOW — `GET /v1/health` exposes the precise version string** on an unauthenticated endpoint. Aids targeted version-specific exploit selection. Recommend omitting version from unauthenticated health responses.

---

## 3. Input Validation

### Zod Schema Coverage — COMPREHENSIVE for most routes

All major POST bodies are validated with Zod schemas. `strict()` is used on most schemas (no extra keys allowed).

### Critical Gaps

**[SD-VAL-01] HIGH — `CreateSessionRequest.env` accepts any key names** (`Record<string, string>`) with no denylist. Any authenticated client can inject:
- `ANTHROPIC_API_KEY` — override the API key used by Claude Code
- `PATH` — prepend a malicious directory
- `HOME` — redirect Claude Code's home directory lookup
- `LD_PRELOAD` — preload arbitrary shared libraries

Recommend an explicit denylist of security-sensitive env keys (`ANTHROPIC_API_KEY`, `PATH`, `LD_PRELOAD`, `HOME`, etc.) or an allowlist of permitted keys.

**[SD-VAL-02] HIGH — `CreateSessionRequest.permissionMode` accepts `'bypassPermissions'`.** Any authenticated API key can create a session with full shell execution without prompts. No "minimum permission mode" server-side policy; no flag to disable this mode from config.

**[SD-VAL-03] MEDIUM — `hookBodySchema` uses `.passthrough()`.** Unknown fields in hook payloads are silently retained and forwarded to SSE subscribers and the event bus.

**[SD-VAL-04] MEDIUM — `CreateSessionRequest.claudeCommand` allows an arbitrary string** up to 10,000 characters. If this reaches a shell (via `exec()` or tmux `send-keys`), it is a direct RCE vector for any authenticated key.

**[SD-VAL-05] LOW — `compareSemver` fails open on unparseable versions.** Returns `0` (equal) when either version is unparseable, causing minimum version enforcement to **allow an unrecognized Claude Code binary**. Recommend returning `-1` (older) when unparseable.

---

## 4. SSRF Protections — STRONG

`ssrf.ts` is well-implemented:
- Blocks all RFC 1918 private ranges, loopback, link-local, CGNAT, multicast, documentation, and benchmarking ranges (IPv4 and IPv6).
- Handles IPv4-mapped IPv6 in hex and dotted-quad form.
- Resolves ALL returned DNS addresses (`{ all: true }`) and rejects if **any** is private.
- Resolved IP is pinned via `buildHostResolverRule` (Chromium) and `buildConnectionUrl` (HTTP clients) to prevent DNS rebinding.

**[SD-SSRF-01] MEDIUM — Residual DNS rebinding window** for the Chromium screenshot path. Between `resolveAndCheckIp()` returning a safe IP and Chromium connecting, an attacker controlling DNS with very short TTL can rebind. The `--host-resolver-rules` mitigation is correctly present; residual risk is low but non-zero.

**[SD-SSRF-02] LOW — `validateWebhookUrl` allows `http://localhost` in `isLocalDev` mode.** If Aegis runs on a server where localhost has sensitive internal services (Redis, metadata endpoints), a developer-mode webhook could reach them.

---

## 5. Path Traversal Risks — GOOD with gaps

`containsTraversalSegment()` applies 4 rounds of `decodeURIComponent` before checking for `..` segments. `validateWorkDir()` calls `fs.realpath()` to resolve symlinks.

**[SD-PATH-01] MEDIUM — `permission-evaluator.ts`'s `isPathAllowed()` uses `path.normalize()` but not `fs.realpath()`.** A symlink pointing outside the allowed prefix would pass the prefix check. The evaluator is the secondary enforcement layer, but files created via symlinks after session start could bypass path constraints.

**[SD-PATH-02] LOW — `hook-settings.ts`'s `validateWorkDirPath()` uses `resolve()` but not `fs.realpath()`.** A symlink path would pass validation even if it points to a sensitive location.

---

## 6. Injection Risks

**[SD-INJ-01] MEDIUM — `verification.ts` uses `exec()` (shell-spawning)** rather than `execFile()` with array arguments for `npx tsc`, `npm run build`, and `npm test`. Commands are hardcoded strings today so no current injection vector, but the structural fragility means any future dynamic use of those command strings would immediately be exploitable.

**[SD-INJ-02] HIGH — No prompt injection mitigations.** The `sendMessageSchema` validates length but performs no content sanitization. Any content reaching Claude Code's input is a prompt injection surface — a malicious caller could inject instructions that override Claude Code's system prompt, leak context, or cause it to execute unintended tool calls. **This is the highest-priority architectural risk in the codebase.**

**[SD-INJ-03] HIGH — `claudeCommand` field — potential command injection.** `CreateSessionRequest.claudeCommand` accepts an arbitrary string up to 10,000 characters with no metacharacter restriction. If this value is passed through a shell in `session.ts`, it is direct RCE for any authenticated API key.

---

## 7. Secrets Management

**[SD-SEC-01] MEDIUM — Hook URLs with `?secret=` are not redacted in Fastify access logs.** The log serializer redacts `token=` in URLs but not `secret=`. If the hook secret falls back to query params, it appears in logs.

**[SD-SEC-02] MEDIUM — Windows `icacls` account built from env vars `USERDOMAIN`/`USERNAME`.** An attacker who controls session `env` (via SD-VAL-01) could manipulate the account name, potentially granting the wrong user access to the key store file. `execFile` array args prevent shell injection, but the account name itself is unvalidated.

**[SD-SEC-03] LOW — Full filesystem paths including home directories logged by `permission-guard.ts`** via `console.log`. These may contain usernames or reveal internal directory structure.

**[SD-SEC-04] LOW — Session IDs visible in diagnostics stream without auth requirement.** Session IDs in an externally-exposed diagnostics stream allow observers to enumerate active sessions without credentials.

**SD-LOG-01] MEDIUM — `verification.ts` captures up to 2,000 characters of build/test output** and returns it to the API caller without sanitization. If `npm test` or build scripts print secrets (test fixtures with API keys, env dumps), these appear in the response.

**[SD-LOG-02] LOW — `console.log` in `hooks.ts`, `hook-settings.ts`, and `permission-guard.ts` bypasses the sanitized `StructuredLogger** and the diagnostics forbidden key list.

---

## 8. OWASP Top 10 Mapping

| # | Category | Aegis Posture | Findings |
|---|----------|--------------|---------|
| **A01** | Broken Access Control | 🔴 WEAK | No session ownership; any key acts on any session; any key manages other keys |
| **A02** | Cryptographic Failures | 🟡 ADEQUATE | Keys hashed with SHA-256; plaintext never persisted; no encryption at rest for key store |
| **A03** | Injection | 🔴 HIGH RISK | Prompt injection unmitigated; `claudeCommand` potential RCE; `env` injection; `exec()` in verification |
| **A04** | Insecure Design | 🟠 MEDIUM | `bypassPermissions` available to any authenticated caller; no multi-tenancy |
| **A05** | Security Misconfiguration | 🟡 LOW-MEDIUM | No auth warning on localhost open-mode; `?secret=` not redacted; version exposed on health |
| **A06** | Vulnerable Components | ⚪ UNKNOWN | Dependency audit needed; `npm audit` runs in CI |
| **A07** | Auth & Session Failures | 🟢 GOOD | Auth-failure rate limiting; SSE token single-use; timing-safe comparison on master token; **keys don't expire** |
| **A08** | Software & Data Integrity | 🟢 GOOD | Atomic file writes via rename; Zod schema validation; session map TTL |
| **A09** | Security Logging & Monitoring | 🟡 ADEQUATE | Structured logging with key/secret sanitisation; `secret=` URL param not redacted |
| **A10** | SSRF | 🟢 STRONG | Comprehensive IP blocklist; all DNS addresses checked; TOCTOU mitigation via IP pinning |

---

## 9. Permission System

### Three-Layer Model
1. **`permissionMode`** per session — set at creation, maps to CC's `--permission-mode` flag.
2. **`permissionProfile`** per session — `allow`/`deny`/`ask` rules evaluated in `evaluatePermissionProfile()` against each incoming `PreToolUse` hook event.
3. **`permission-guard.ts`** — neutralizes CC settings files that declare `bypassPermissions`.

### Bypass Vectors

**[SD-PERM-01] MEDIUM — `extractCandidatePaths()` only checks known field names** (`path`, `file_path`, `target`, `paths[]`). A CC tool naming its path argument `destination`, `output_path`, or `filename` would bypass path constraints entirely.

**[SD-PERM-02] MEDIUM — `isLikelyWriteTool()` regex misses common write tool names.** The regex `/write|edit|delete|rename|move|create/i` misses `overwrite_file`, `patch_file`, `truncate_file`, etc. The `readOnly` constraint is fragile.

**[SD-PERM-03] LOW — `globToRegExp()` does not anchor the middle** — `*` becomes `.*` matching newlines. A crafted tool input with a newline before the pattern could circumvent glob matching.

**[SD-PERM-04] LOW — `permission-guard.ts` only patches `bypassPermissions`**, not `acceptEdits` or `dontAsk`, which also suppress permission prompts for file edits and tool calls.

---

## 10. Enterprise Security Gaps

| Capability | Status | Risk Level |
|-----------|--------|-----------|
| **SSO / SAML / OIDC** | ❌ Not implemented | 🔴 Critical — no integration with corporate identity providers |
| **RBAC / Roles** | ❌ Not implemented | 🔴 Critical — all keys are equal; no least-privilege |
| **Audit logging** | ⚠️ Partial | 🔴 Critical — no tamper-evident append-only audit trail (SOC2/ISO 27001 gap) |
| **Key expiry** | ❌ Not implemented | 🟠 High — violates most enterprise key rotation policies (e.g., 90-day rotation) |
| **MFA** | ❌ Not applicable | API key security relies entirely on the key remaining secret |
| **Data residency controls** | ❌ No controls | Sessions placed in `workDir` and `~/.aegis/` with no region/jurisdiction constraints |
| **Token scoping** | ❌ Not implemented | Cannot issue a read-only key for dashboards vs admin key for key management |
| **Session isolation** | ❌ Not implemented | All sessions visible to all keys; multi-tenant scenario not supported |
| **Prompt injection mitigations** | ❌ None | LLM input reaches CC without any content policy enforcement |
| **Compliance controls** | ❌ None | No PCI-DSS, HIPAA, or GDPR data handling controls |

---

## 11. Prioritised Security Findings

| ID | Severity | Finding |
|----|----------|---------|
| SD-INJ-02 | 🔴 HIGH | Prompt injection: arbitrary text reaches Claude Code with no sanitisation |
| SD-INJ-03 | 🔴 HIGH | `claudeCommand` field — potential RCE |
| SD-VAL-01 | 🔴 HIGH | `env` field allows overriding security-sensitive environment variables |
| SD-AUTHZ-01 | 🔴 HIGH | No session ownership — any key can approve/kill any session |
| SD-VAL-02 | 🔴 HIGH | Any authenticated key can create `bypassPermissions` sessions |
| SD-AUTHZ-02 | 🟠 MEDIUM | Any key can create/revoke other API keys (no admin role) |
| SD-AUTH-03 | 🟠 MEDIUM | API keys never expire; no rotation mechanism |
| SD-PERM-01 | 🟠 MEDIUM | Permission path constraints bypassable via non-standard tool field names |
| SD-PERM-02 | 🟠 MEDIUM | `isLikelyWriteTool()` heuristic regex misses common write tool names |
| SD-INJ-01 | 🟠 MEDIUM | `verification.ts` uses `exec()` shell — structurally fragile |
| SD-SSRF-01 | 🟠 MEDIUM | Residual DNS rebinding window (partially mitigated) |
| SD-SEC-01 | 🟠 MEDIUM | `?secret=` hook URL query param not redacted in Fastify access logs |
| SD-SEC-02 | 🟠 MEDIUM | Windows `icacls` account built from manipulable env vars |
| SD-LOG-01 | 🟠 MEDIUM | Build/test output returned to caller without secret sanitisation |
| SD-PATH-01 | 🟠 MEDIUM | Permission evaluator uses `normalize()` not `realpath()` — symlink bypass |
| SD-VAL-03 | 🟠 MEDIUM | `hookBodySchema.passthrough()` forwards unknown fields to all SSE subscribers |
| SD-PATH-02 | 🟡 LOW | `hook-settings.ts` uses `resolve()` not `realpath()` |
| SD-AUTH-01 | 🟡 LOW | Key lookup uses plain `===` on hashes (not timing-safe) |
| SD-AUTH-02 | 🟡 LOW | No startup warning when running in no-auth mode |
| SD-SSRF-02 | 🟡 LOW | HTTP to localhost allowed in webhook dev mode |
| SD-VAL-04 | 🟠 MEDIUM | `claudeCommand` has no metacharacter restriction |
| SD-VAL-05 | 🟡 LOW | `compareSemver` fails open on unparseable versions |
| SD-PERM-03 | 🟡 LOW | `globToRegExp` `.*` matches newlines |
| SD-PERM-04 | 🟡 LOW | Permission guard only patches `bypassPermissions`, not `acceptEdits`/`dontAsk` |
| SD-AUTHZ-03 | 🟡 LOW | Hook secret check duplicated in middleware and handler |
| SD-AUTHZ-04 | 🟡 LOW | Version string exposed on unauthenticated `/v1/health` |
| SD-SEC-03 | 🟡 LOW | Full filesystem paths in permission-guard console logs |
| SD-SEC-04 | 🟡 LOW | Session IDs visible in diagnostics stream |
| SD-LOG-02 | 🟡 LOW | Unstructured `console.log` in hooks/permission code bypasses sanitiser |

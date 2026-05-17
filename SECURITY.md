# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `develop` branch | ✅ Active development |
| Latest release | ✅ Security fixes |
| Previous minor | ⚠️ Critical fixes only |
| Older versions | ❌ End of life |

We follow semantic versioning. Security patches are released as patch versions (e.g., `0.6.7` → `0.6.8`) and backported to the previous minor at our discretion.

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Send reports to **security@aegis.dev** (or open a private [GitHub Security Advisory](https://github.com/OneStepAt4time/aegis/security/advisories/new)).

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

We aim to acknowledge reports within **24 hours** and provide a fix or mitigation within **72 hours** for critical issues. Valid reports are credited in the CHANGELOG and advisory unless you request anonymity.

## Security Features

### Authentication

- **Master bearer token** — 256-bit token via `AEGIS_AUTH_TOKEN` env var. SHA-256 hashed at rest, plaintext returned only at creation.
- **API keys** — Scoped keys with roles (`admin`, `operator`, `viewer`). SHA-256 hashed at rest with `0o600` file permissions.
- **SSE tokens** — Short-lived (60s), single-use tokens for event streams. Capped at 5 concurrent per key.
- **OIDC** — OpenID Connect authentication for enterprise deployments.

### Authorization (RBAC)

Three roles with principle-of-least-privilege:

| Role | Create sessions | Approve/reject | Manage keys | View sessions |
|------|----------------|----------------|-------------|---------------|
| `admin` | ✅ | ✅ | ✅ | ✅ |
| `operator` | ✅ | ✅ | ❌ | ✅ |
| `viewer` | ❌ | ❌ | ❌ | ✅ (own tenant only) |

- **Session ownership** — tenants can only access their own sessions
- **`strictRBAC`** — enforce role checks even when auth is disabled (`AEGIS_STRICT_RBAC=true`)
- **Self-demotion guard** — keys cannot elevate their own role

### Secret Redaction

- ACP payloads are sanitized before logging — API keys, tokens, and credentials are replaced with `[REDACTED]`
- Sensitive environment variables are stripped from process telemetry
- Environment denylist blocks injection of `ANTHROPIC_API_KEY`, `PATH`, `HOME`, `LD_PRELOAD`, and other security-sensitive keys via session creation

### Audit Logging

Tamper-evident append-only audit trail:

- Each record chained via SHA-256 hashes (record N includes hash of N-1)
- Retroactive edits are detectable
- Daily rotation, never overwritten
- Covers: key creation, session lifecycle, approvals, rejections, configuration changes

### Network Security

- **SSRF protection** — blocks RFC 1918 private ranges, loopback, link-local, CGNAT, multicast, and IPv4-mapped IPv6 addresses
- **Rate limiting** — per-IP limits (no-auth: 120 req/min, master token: 300 req/min)
- **Dashboard static rate limiting** — per-IP fixed-window limiter for asset routes
- **Session ID enumeration prevention** — unauthorized sessions return `404` instead of `403`
- **Default bind** — `127.0.0.1` only (no external exposure unless explicitly configured)

### Input Validation

- All POST bodies validated with Zod schemas (`strict()` mode — no extra keys)
- Model strings validated with regex + length check
- Session names restricted to safe characters
- Work directories validated (system temp dirs rejected, file paths rejected)
- Hook payloads validated with HMAC secret support

### Permission Modes

Claude Code permissions can be scoped per session:

| Mode | Behavior |
|------|----------|
| `default` | Prompt for every tool call |
| `acceptEdits` | Auto-approve file edits, prompt for shell |
| `dontAsk` | Auto-approve all non-destructive tools |
| `auto` | Auto-approve everything |
| `bypassPermissions` | Full bypass (requires `--passthrough` or `--accept-permissions`) |

Permission modes are validated against the Zod schema at runtime.

## Security Configuration

Key environment variables for hardening:

```bash
# Enable authentication (required for production)
AEGIS_AUTH_TOKEN=your-secure-token

# Enforce RBAC even without auth
AEGIS_STRICT_RBAC=true

# Scope session working directories
AEGIS_ALLOWED_WORKDIRS=/home/user/projects:/workspace

# Bind to localhost only (default)
AEGIS_HOST=127.0.0.1
```

See [Enterprise Configuration](docs/enterprise.md) for the full reference.

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Unauthorized API access | Bearer tokens + API keys with RBAC |
| Session hijacking | Tenant-scoped ownership, 404 on unauthorized |
| Credential leakage in logs | Automatic secret redaction |
| SSRF via webhook/hook URLs | Comprehensive private IP blocking |
| Env var injection | Denylist of security-sensitive keys |
| Audit log tampering | SHA-256 hash chain |
| Brute-force API keys | SHA-256 hashed at rest, rate limiting |
| Privilege escalation | Role hierarchy with self-demotion guard |

## Known Security Issues

See [Security Advisories](https://github.com/OneStepAt4time/aegis/security/advisories) for disclosed vulnerabilities and their fixes.

## Credits

Security posture reviewed by Themis (Security Auditor).

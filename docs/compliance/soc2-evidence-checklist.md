# SOC 2 Audit Evidence Checklist

> **Purpose:** Checklist of evidence artifacts to collect for SOC 2 Type II audit. Maps each evidence type to its source location and responsible party.
>
> **Status:** Pre-activation prep — not all evidence sources are fully automated yet. Items marked ⚠️ require manual collection or tooling that doesn't exist yet.

---

## Evidence Categories

### 1. Access Control Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 1.1 | API key inventory (hashes, roles, creation dates) | `{stateDir}/keys.json` | Scripted export | Per audit | ✅ Available |
| 1.2 | Key creation / revocation / rotation events | `{stateDir}/audit/YYYY-MM-DD.jsonl` | Audit log query | Continuous | ✅ Available |
| 1.3 | Session ownership enforcement config | `aegis.config.ts` — `enforceSessionOwnership` | Config snapshot | Per audit | ✅ Available |
| 1.4 | RBAC permission matrix | `src/config.ts` — role definitions | Code review | Per release | ✅ Available |
| 1.5 | Dashboard auth configuration | Dashboard login flow test | Manual / automated test | Per release | ✅ Available |

### 2. Authentication Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 2.1 | Auth failure events with IP tracking | `{stateDir}/audit/YYYY-MM-DD.jsonl` | Audit log query | Continuous | ✅ Available |
| 2.2 | Rate limiting configuration | `src/routes/auth.ts` — rate limits | Config snapshot | Per audit | ✅ Available |
| 2.3 | SSE token TTL and usage policy | `src/routes/sessions.ts` — SSE config | Code review | Per release | ✅ Available |
| 2.4 | Lockout event records | Audit log — lockout entries | Audit log query | Continuous | ✅ Available |

### 3. Encryption Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 3.1 | Encryption algorithm documentation | `src/hooks.ts` — AES-256-GCM | Code review | Per release | ✅ Available |
| 3.2 | Key derivation function documentation | `src/hooks.ts` — scrypt parameters | Code review | Per release | ✅ Available |
| 3.3 | API key hashing verification | `src/config.ts` — SHA-256 | Test suite | Per release | ✅ Available |
| 3.4 | File permission audit | `secureFilePermissions()` output | Scripted check | Per audit | ⚠️ Manual |
| 3.5 | TLS configuration (reverse proxy) | Deployer infrastructure | Deployer documentation | Per audit | ⚠️ Deployer responsibility |

### 4. Audit Trail Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 4.1 | Audit log chain integrity proof | `{stateDir}/audit/` — SHA-256 chain | Integrity verification script | Per audit | ✅ Available |
| 4.2 | Audit log coverage (event types) | `src/audit.ts` — event type enumeration | Code review | Per release | ✅ Available |
| 4.3 | Token redaction verification | `src/logger.ts` — redaction rules | Test suite | Per release | ✅ Available |
| 4.4 | Daily rotation verification | Audit file dates | Scripted check | Per audit | ✅ Available |

### 5. Change Management Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 5.1 | Branch protection rules | GitHub repo settings | GitHub API | Per audit | ✅ Available |
| 5.2 | PR review records | GitHub PR history | GitHub API | Continuous | ✅ Available |
| 5.3 | Release artifact provenance (Sigstore) | Release workflow — attestations | Sigstore verification | Per release | ✅ Available |
| 5.4 | Quality gate results (`npm run gate`) | CI logs | CI artifact | Per PR | ✅ Available |
| 5.5 | Release changelog | `CHANGELOG.md` | Git history | Per release | ✅ Available |

### 6. Vulnerability Management Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 6.1 | Dependency audit results | `npm audit` output | CI step | Per PR | ⚠️ Not in CI yet |
| 6.2 | SBOM (Software Bill of Materials) | Release workflow — SBOM generation | CI artifact | Per release | ✅ Available |
| 6.3 | Static analysis results | CodeQL / Snyk | CI step | Per PR | ⚠️ Not configured |
| 6.4 | Input validation coverage | Zod schema enumeration | Code review | Per release | ✅ Available |

### 7. Monitoring Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 7.1 | OpenTelemetry trace samples | OTel export | OTel collector | Continuous | ⚠️ Placeholder |
| 7.2 | Prometheus metrics snapshot | `/v1/metrics` endpoint | Prometheus scrape | Continuous | ✅ Available |
| 7.3 | Alert webhook delivery logs | Webhook consumer logs | External system | Continuous | ⚠️ Deployer responsibility |
| 7.4 | Session health diagnostics | `/v1/health`, `/v1/swarm` | API query | Per audit | ✅ Available |

### 8. Infrastructure Evidence

| # | Evidence | Source | Collection Method | Frequency | Status |
|---|----------|--------|-------------------|-----------|--------|
| 8.1 | Deployment configuration | `aegis.config.ts`, environment variables | Config snapshot | Per audit | ✅ Available |
| 8.2 | Network binding configuration | Default `127.0.0.1` binding | Config review | Per audit | ✅ Available |
| 8.3 | SSRF blocklist contents | `src/utils/ssrf.ts` | Code review | Per release | ✅ Available |
| 8.4 | Backup verification | `state.json.bak` existence | Scripted check | Per audit | ⚠️ Manual |

---

## Collection Automation Roadmap

Evidence items marked ⚠️ need automation before formal audit engagement:

1. **File permission audit script** — cron job to verify `0o600` on sensitive files
2. **Dependency scanning in CI** — integrate `npm audit` or Snyk into PR workflow
3. **Static analysis** — enable CodeQL on `develop` branch
4. **OpenTelemetry completion** — wire end-to-end tracing and export to collector
5. **Backup automation** — scheduled backup + integrity verification
6. **Evidence export API** — scripted endpoint to extract audit evidence for SIEM/SOC tools

---

## Evidence Retention

- **Audit logs:** Indefinite (until manually purged). See [Data Retention Policy](./data-retention-policy.md).
- **SBOMs:** Per-release, stored in release artifacts.
- **CI artifacts:** Per GitHub retention policy (default 90 days).
- **Config snapshots:** Per audit cycle.

For full retention schedules, see [`docs/RETENTION_POLICY.md`](../RETENTION_POLICY.md).

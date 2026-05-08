# Incident Response Runbook

> **Version:** 1.0.0 (template)
> **Last reviewed:** 2026-05-08
> **Status:** Template — customize for your organization and deployment.

This runbook defines the incident response process for security events affecting an Aegis deployment. It provides a structured triage, containment, communication, and postmortem workflow.

> **Note:** This is a template. Deployers should customize roles, escalation paths, and communication channels for their organization.

---

## 1. Severity Levels

| Level | Name | Description | Examples | Response Time |
|-------|------|-------------|----------|---------------|
| **SEV1** | Critical | Active exploitation, data breach, or complete service outage | Compromised API keys, unauthorized access confirmed, audit chain tampering | 15 minutes |
| **SEV2** | High | Vulnerability with known exploit path, significant degradation | Auth bypass discovered, rate limiting failure, session data leak | 1 hour |
| **SEV3** | Medium | Vulnerability without active exploit, partial degradation | Misconfigured CORS, expired TLS certificate, single-session compromise | 4 hours |
| **SEV4** | Low | Informational, hardening opportunities | Dependency vulnerability (no exploit), log redaction gap, missing security header | 24 hours |

## 2. Incident Response Roles

| Role | Responsibility |
|------|---------------|
| **Incident Commander (IC)** | Owns the incident end-to-end. Coordinates response, makes containment decisions, authorizes communication. |
| **Technical Lead** | Performs root cause analysis, implements fixes, validates containment. |
| **Communications Lead** | Manages stakeholder communication, status updates, postmortem distribution. |
| **Scribe** | Documents timeline, decisions, and actions during incident. Maintains incident log. |

> For small teams, the IC may also serve as Technical Lead and Scribe.

## 3. Response Process

### Phase 1: Triage (0–15 minutes)

1. **Detect** — Identify the incident source:
   - Alert webhook triggered (`/v1/hooks/:eventName`)
   - Audit log anomaly (`{stateDir}/audit/`)
   - Health check failure (`/v1/health`)
   - External report (security advisory, user report)

2. **Classify** — Assign severity level (see §1).

3. **Assign** — Designate IC and activate response roles.

4. **Log** — Open incident record:
   ```
   Incident ID: INC-[YYYY-MM-DD]-[seq]
   Severity: SEV[1-4]
   Detected at: [timestamp]
   Detected by: [source]
   IC: [name]
   ```

### Phase 2: Containment (15–60 minutes)

1. **Immediate containment:**
   - Revoke compromised API keys: `DELETE /v1/auth/keys/:id`
   - Kill affected sessions: `POST /v1/sessions/:id/kill`
   - Block suspicious IPs (if applicable — deployer infrastructure)
   - Enable maintenance mode (if applicable)

2. **Evidence preservation:**
   - Snapshot audit logs: copy `{stateDir}/audit/` to secure location
   - Capture session state: `GET /v1/sessions` (all sessions)
   - Export metrics snapshot: `GET /v1/metrics`
   - Record health status: `GET /v1/health`, `GET /v1/swarm`

3. **Assess blast radius:**
   - Review audit logs for the affected key ID / time window
   - Identify all sessions created/modified by the compromised key
   - Check for lateral movement (other keys used from same IP)

### Phase 3: Eradication (1–4 hours)

1. **Root cause analysis:**
   - Identify the vulnerability or misconfiguration that enabled the incident
   - Document the attack path or failure chain
   - Determine if the issue is in Aegis code, configuration, or infrastructure

2. **Fix:**
   - Apply security patch (if Aegis code issue — update to latest version)
   - Correct configuration (if misconfiguration — update `aegis.config.ts`)
   - Harden infrastructure (if infrastructure issue — update deployment)

3. **Validate:**
   - Run `npm run gate` to verify no regressions
   - Re-run health checks: `/v1/health`
   - Verify audit chain integrity post-fix
   - Test the fix against the original attack vector

### Phase 4: Recovery (4–24 hours)

1. **Restore service:**
   - Rotate all potentially compromised credentials (API keys, master token, webhook secrets)
   - Verify all sessions are healthy: `GET /v1/sessions`
   - Remove maintenance mode (if enabled)
   - Monitor for recurrence: watch audit logs, metrics, alert webhooks

2. **Verify:**
   - Confirm no residual access from compromised credentials
   - Validate that all containment measures are in place
   - Run full test suite against the deployment

### Phase 5: Postmortem (24–72 hours)

1. **Write postmortem document:**
   ```
   ## Incident Postmortem: INC-[ID]
   
   ### Summary
   [1-2 sentence description]
   
   ### Timeline (all times UTC)
   - [HH:MM] — Detection
   - [HH:MM] — Containment
   - [HH:MM] — Root cause identified
   - [HH:MM] — Fix deployed
   - [HH:MM] — Recovery complete
   
   ### Root Cause
   [Detailed analysis]
   
   ### Impact
   - Sessions affected: [count]
   - Data exposed: [categories]
   - Duration: [time]
   
   ### What Went Well
   - [positive outcomes]
   
   ### What Could Be Improved
   - [areas for improvement]
   
   ### Action Items
   - [ ] [action] — owner, due date
   ```

2. **Distribute** — Share postmortem with stakeholders within 72 hours.

3. **Track** — Create GitHub issues for all action items. Tag with `security` and `compliance`.

---

## 4. Aegis-Specific Incident Scenarios

### 4.1 API Key Compromise

| Step | Action |
|------|--------|
| Detect | Alert webhook or audit log shows unauthorized API calls |
| Contain | `DELETE /v1/auth/keys/:id` — revoke compromised key immediately |
| Assess | Grep audit logs for key ID: `grep "keyId" audit/*.jsonl` |
| Eradicate | Rotate master token if key had admin role |
| Recover | Issue new key with minimal required permissions |

### 4.2 Audit Chain Tampering

| Step | Action |
|------|--------|
| Detect | Chain integrity check fails (SHA-256 mismatch) |
| Contain | Take server offline for investigation |
| Assess | Identify which daily file was tampered with and when |
| Eradicate | Determine how the file was modified (filesystem access, process injection) |
| Recover | Restore audit files from backup; harden filesystem permissions |

### 4.3 Session Hijacking

| Step | Action |
|------|--------|
| Detect | Session performing unexpected actions; alert webhook triggered |
| Contain | `POST /v1/sessions/:id/interrupt` then `POST /v1/sessions/:id/kill` |
| Assess | Review transcript: `GET /v1/sessions/:id/transcript` |
| Eradicate | Revoke owning API key; check for other sessions from same key |
| Recover | Create new session with fresh credentials |

### 4.4 SSRF Exploit Attempt

| Step | Action |
|------|--------|
| Detect | Logs show URL validation failures for internal IPs |
| Contain | No action needed if SSRF protection working — blocked by design |
| Assess | Identify source key/IP; check if any requests bypassed validation |
| Eradicate | If bypass found, patch immediately and report upstream |
| Recover | Monitor for repeated attempts; consider IP blocking |

---

## 5. Communication Templates

### Internal Notification

```
Subject: [SEV1/2/3/4] Incident INC-[ID] — [Brief Description]

Team,

We have detected a [severity] incident affecting [component].

Current status: [Triage/Containment/Eradication/Recovery]
IC: [name]
Impact: [affected systems/users]

Next update in: [time]
```

### External Notification (if required)

```
Subject: Security Incident Notification — [Service Name]

We are writing to inform you of a security incident affecting [scope].
[Description of what happened, what data was affected, what actions were taken.]
[Remediation steps and timeline.]
[Contact information for questions.]
```

---

## 6. Aegis Evidence Sources

During incident response, collect evidence from these sources:

| Source | Location | Purpose |
|--------|----------|---------|
| Audit logs | `{stateDir}/audit/YYYY-MM-DD.jsonl` | Tamper-evident record of all authenticated actions |
| Session state | `GET /v1/sessions` | Active session inventory |
| Session transcripts | `GET /v1/sessions/:id/transcript` | Full message history per session |
| Health status | `GET /v1/health`, `GET /v1/swarm` | System health diagnostics |
| Metrics | `GET /v1/metrics` | Prometheus metrics snapshot |
| Key store | `{stateDir}/keys.json` | API key inventory |
| Configuration | `aegis.config.ts` | Current runtime configuration |

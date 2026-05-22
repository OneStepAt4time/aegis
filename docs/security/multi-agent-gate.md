# Multi-Agent Security Gate — Requirements & Self-Certification

> **Owner:** Themis (Security Auditor)
> **Source:** Issue #3980
> **Scope:** Feature PRs #3970–#3978
> **Last reviewed:** 2026-05-22

This document defines the hard security requirements that **must be satisfied** before any feature PR in the #3970–#3978 range can merge. Themis holds the veto.

---

## Blocking Relationships

The following feature issues **cannot merge** until the specified security requirements are met:

| Feature Issue | Title | Blocked by |
|--------------|-------|------------|
| **#3970** | Task Queue system | **Req 1** (adapter sandboxing) + **Req 2** (identity verification) |
| **#3971** | Agent Profiles | **Req 1** (adapter sandboxing) + **Req 2** (identity verification) |
| **#3972** | Autopilots | **Req 1** + **Req 2** (via #3970/#3971 dependencies) |
| **#3973** | Squads | **Req 1** + **Req 2** + **Req 3** (squad scope constraints) |
| **#3974** | Inbox notifications | **Req 2** (identity verification for agent-related notifications) |
| **#3975** | Agent Chat | **Req 2** (identity verification for 1:1 conversations) |
| **#3976** | Agent Skills | **Req 1** (capability whitelisting for skill execution) |
| **#3978** | Comments & @Mentions | **Req 2** (identity verification for mention routing) |
| All features | — | **Req 4** (no external storage exfiltration — ✅ already met) |

### Critical path

```
#3971 (Agent Profiles) ──blocked-by──► Req 1 + Req 2
#3970 (Task Queue) ──blocked-by──► Req 1 + Req 2
    │
    ▼ (once #3970 + #3971 ship)
#3972 (Autopilots) ──blocked-by──► Req 1 + Req 2 (inherited)
#3973 (Squads) ──blocked-by──► Req 1 + Req 2 + Req 3
#3974–#3978 ──blocked-by──► Req 2 + subset of Req 1
```

**Nobody should build features on top of #3970/#3971 until Req 1 and Req 2 are resolved in those PRs.** Building ahead is fine for prototyping, but PRs will not merge.

---

## Requirement 1: Per-adapter sandboxing and capability whitelisting

**Status:** ❌ NOT MET (partially implemented)

**Applies to:** #3970, #3971, #3972, #3973, #3976

### What exists today

- ✅ Env denylist in `src/validation.ts` — 50+ entries blocking `AWS_*`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `LD_PRELOAD`, `npm_config_*`, `ssh_*`, etc.
- ✅ Config-driven additive denylist (`AEGIS_ENV_DENYLIST`) and admin allowlist (`AEGIS_ENV_ADMIN_ALLOWLIST`)
- ✅ Permission guard in `src/permission-guard.ts` — neutralizes `bypassPermissions` in Claude Code settings before spawn
- ✅ Minimal child env construction in `src/acp-spawn-env.ts` (not a full passthrough)

### What's missing (must ship with #3970/#3971)

1. **Filesystem access controls**
   - Each adapter must define a read/write directory whitelist
   - Default: `cwd` + subdirs only
   - Blocked: `/etc`, `~/.ssh`, `/tmp` traversal (`../../tmp`), any path outside workspace
   - Implementation: path resolution + boundary check before child process spawn

2. **Network access controls**
   - Each adapter must define a host/port allowlist
   - Default: localhost only
   - External hosts require explicit allowlist entry in adapter config
   - Implementation: network namespace, proxy layer, or OS-level firewall rules

3. **CLI arg filtering**
   - User-configured custom args must be filtered for protocol-critical flags
   - Blocked flags: `--output-format`, `--resume`, `--session-id`, `--permission-mode`
   - Equivalent to Multica's `filterCustomArgs` in `server/pkg/agent/claude.go`

### Self-certification checklist

Feature PR authors must confirm all applicable items:

- [ ] Filesystem whitelist defined for each adapter, default is cwd-only
- [ ] Test: adapter rejects attempt to read `/etc/shadow`
- [ ] Test: adapter rejects path traversal (`../../etc/passwd`)
- [ ] Network allowlist defined for each adapter, default is localhost-only
- [ ] Test: adapter rejects connection to non-allowlisted host
- [ ] CLI arg filter strips protocol-critical flags from user input
- [ ] Test: custom arg containing `--output-format` is filtered
- [ ] Env denylist enforced on child process (already exists, confirm no regression)
- [ ] Test: denylisted env var stripped from child process environment

---

## Requirement 2: Agent identity verification on task dispatch

**Status:** ❌ NOT MET (not implemented)

**Applies to:** #3970, #3971, #3972, #3973, #3974, #3975, #3978

### What exists today

- ✅ Provider env allowlist in `src/acp-lifecycle-probe.ts:336`
- ✅ Session workspace ownership validation in `src/routes/sessions.ts`
- ✅ Audit logging infrastructure in `src/audit.ts`

### What's missing (must ship with #3970/#3971)

1. **Agent registry** — agents must be persisted entities with lifecycle states (active, archived, deleted)
2. **Dispatch validation pipeline:**
   - Agent exists and is active (not archived/deleted) → 404 if not
   - Agent owner has workspace access → 403 if cross-workspace
   - Agent runtime is healthy (`last_heartbeat` within threshold) → 503 if stale
   - Dispatching entity is authenticated to assign to this specific agent → 403 if unauthorized
3. **Prevention of:**
   - Agent A impersonating Agent B to steal tasks
   - Cross-tenant task assignment
   - Privilege escalation via agent ownership transfer

### Self-certification checklist

- [ ] Agent registry exists with lifecycle states (active/archived/deleted)
- [ ] Test: dispatch to archived agent returns error (404 or appropriate code)
- [ ] Test: dispatch to deleted agent returns 404
- [ ] Test: cross-workspace dispatch returns 403
- [ ] Agent runtime health check: `last_heartbeat` within configurable threshold
- [ ] Test: dispatch to agent with stale heartbeat is rejected
- [ ] Dispatching entity authentication: verifies right to assign to target agent
- [ ] Test: unauthorized dispatch (wrong owner, wrong workspace) returns 403
- [ ] All dispatch events logged to audit trail with agent IDs + timestamp

---

## Requirement 3: Squad leader scope constraints

**Status:** ⏸️ NOT YET APPLICABLE (no squad code exists)

**Applies to:** #3973

### Requirements (to be implemented with #3973)

1. **Delegation scope:** Leader can only delegate to members of its own squad
2. **Audit trail:** Every delegation logged with: leader ID, target ID, issue ID, timestamp, reason
3. **Human approval gate:** Sensitive operations require human approval even when delegated by a leader:
   - Merging to protected branches
   - Deploying to production
   - Modifying agent configs
   - Accessing secrets/environment variables
4. **Archiving cascade:** Archived squad → tasks transfer to leader, no new tasks, members notified
5. **Leader rotation:** Only workspace admin can change squad leader

### Self-certification checklist

- [ ] Test: leader cannot delegate to agent outside its squad
- [ ] Delegation events logged with all required fields
- [ ] Test: leader merge attempt blocked without human approval
- [ ] Test: leader deploy attempt blocked without human approval
- [ ] Test: archiving squad cancels pending tasks + transfers active to leader
- [ ] Test: agent-initiated leader rotation is rejected
- [ ] Human approval gate configurable (which operations require it)

---

## Requirement 4: No S3/external file storage exfiltration path

**Status:** ✅ MET

**Applies to:** All features

### Verification (2026-05-22)

```
grep -rn "S3_\|GCS_\|AZURE_BLOB_\|aws-sdk\|@aws-sdk\|@google-cloud/storage" src/
→ zero hits in production code
```

No external storage SDK imports. No agent-writable file upload endpoints. No artifact storage outside workspace boundary.

### Ongoing gate

- [ ] No new feature PR introduces external storage SDK imports in agent code paths
- [ ] No new feature PR adds agent-writable upload endpoints without human approval
- [ ] Grep assertion passes in CI (recommended: add to `npm run gate`)

---

## Review process

1. **Feature PR author** completes applicable checklists in PR description under `## Security Self-Certification`
2. **Themis** reviews code + tests against each checked item
3. **Themis** approves or rejects with specific remediation required
4. **Argus** includes security gate check in final merge review
5. **No PR in #3970–#3978 merges without Themis sign-off on all applicable requirements**

---

*Themis 🛡️ — Security Auditor*

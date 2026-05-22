# Security Requirements for Multi-Agent Features

> **Applies to:** Issues #3970–#3978 (Task Queue, Agent Profiles, Autopilots, Squads, Inbox, Chat, Skills, Comments)
>
> **Gate holder:** Themis (Security Auditor). No feature PR in this range merges without all requirements passing review.
>
> **Tracking issue:** #3980

---

## Overview

This document defines the four hard security requirements that every multi-agent feature must satisfy before merge. These were identified during the competitive analysis of Multica and represent the minimum security posture for agent-to-agent interactions.

**Principle:** Every new agent capability is an attack surface. These requirements ensure that adding multi-agent features does not compromise the isolation, audit, and governance guarantees that Aegis provides today.

---

## Requirement 1: Per-Adapter Sandboxing and Capability Whitelisting

**Applies to:** #3971 (Agent Profiles), #3970 (Task Queue)

Each agent runtime adapter (Claude Code, Codex, Gemini, etc.) must define an explicit capability whitelist.

### Capabilities to Whitelist

| Capability | Default Policy | Override Mechanism |
|-----------|---------------|-------------------|
| **Filesystem access** | cwd + subdirs only. No `/etc`, `~/.ssh`, `/tmp` traversal | `isolationPolicy` config |
| **Network access** | localhost only. External hosts require explicit allowlist | Egress proxy or namespace config |
| **Environment variables** | Denylist enforced: no `AWS_*`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY` etc. unless explicitly permitted | Per-session `env` parameter |
| **CLI args** | Protocol-critical flags filtered (e.g., `--output-format`, `--resume`, `--session-id`) | Adapter-level `filterCustomArgs` |

### Gate Test Checklist

Each adapter must include a test proving:

- [ ] A command trying to read `/etc/shadow` is rejected
- [ ] A command with `--output-format` override is filtered
- [ ] An env var in the denylist is stripped from the child process

### Reference Implementation

Multica implements this in `filterCustomArgs` (`server/pkg/agent/claude.go`), which blocks `--output-format`, `--resume`, `--session-id` from user-configured custom args. Aegis needs the equivalent per-adapter.

### Current Aegis Coverage

Based on Themis security review (2026-05-22):

- ✅ **Env var denylist** — 50+ entries in `src/validation.ts`, blocks `AWS_*`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `LD_PRELOAD`, `npm_config_*`, `ssh_*`, etc. Config-driven additive denylist + admin allowlist
- ✅ **Permission bypass neutralization** — `src/permission-guard.ts` neutralizes `bypassPermissions` in all 3 CC settings locations before spawn
- ✅ **Minimal child env** — `src/acp-spawn-env.ts` constructs minimal env (not passthrough)
- ✅ **CLI arg filtering** — added in #4019
- ✅ **WorkDir restriction** — `AEGIS_ALLOWED_WORK_DIRS` config
- ⚠️ **Filesystem sandboxing** — not enforced. Child processes inherit full workdir with no restriction on reading `/etc/shadow`, `~/.ssh/`, or traversing `/tmp`
- ⚠️ **Network egress filtering** — documented as known limitation (ADR-0030). No localhost-only default or host allowlist for adapter child processes
- ⚠️ **ANTHROPIC_/CLAUDE_ env vars forwarded** — intentional for auth but contradicts "explicit allowlist only" model. Needs documented decision

**Verdict: ❌ NOT MET** — Infrastructure exists for env sanitization but filesystem, network, and CLI arg controls need work.

---

## Requirement 2: Agent Identity Verification on Task Dispatch

**Applies to:** #3971 (Agent Profiles), #3970 (Task Queue), #3973 (Squads)

When a task is dispatched to an agent, the system must verify all four conditions:

### Verification Checklist

1. **Agent exists and is active** (not archived) — prevents dispatching to deleted agents
2. **Agent owner has workspace access** — prevents cross-workspace task injection
3. **Agent runtime is healthy** — runtime `last_heartbeat` within threshold
4. **Agent identity is authenticated** — the dispatching entity (human, autopilot, squad leader) must prove it has the right to assign to this specific agent

### Threat Model

Without these checks:

- Agent A could impersonate Agent B to steal tasks
- Cross-tenant task assignment could leak data
- Privilege escalation via agent ownership transfer

### Gate Test Checklist

- [ ] Dispatching to an archived agent returns 403
- [ ] Dispatching to a cross-workspace agent returns 403
- [ ] Dispatching to an agent with no healthy runtime returns 403

### Current Aegis Coverage

Based on Themis security review (2026-05-22):

- ✅ **Session ownership** — `createdByKeyId` on sessions (ADR-0019)
- ✅ **RBAC** — viewer/operator/admin roles with `strictRBAC` option
- ✅ **Provider env allowlist** — enforced in `src/acp-lifecycle-probe.ts`
- ✅ **Workspace ownership validation** — session routing validates workspace ownership in `src/routes/sessions.ts`
- ⚠️ **Agent identity model** — no agent registry or profile system exists yet (depends on #3971)
- ⚠️ **Runtime health check** — no `last_heartbeat` tracking for agent runtimes
- ⚠️ **Dispatch authentication** — no mechanism to verify dispatching entity rights
- ⚠️ **Cross-workspace isolation** — no multi-tenancy model

**Verdict: ❌ NOT MET** — Feature code doesn't exist yet. Must be implemented with #3970/#3971.

---

## Requirement 3: Squad Leader Scope Constraints

**Applies to:** #3973 (Squads)

Squad leaders have delegation power — they can assign work to squad members. This creates a privilege escalation surface if a leader agent is compromised or misconfigured.

### Hard Requirements

1. **Leader can only delegate to members of its own squad.** No cross-squad or arbitrary agent delegation.
2. **Leader delegation is auditable.** Every delegation event (leader → member) is logged with:
   - Leader agent ID
   - Target agent ID
   - Issue ID
   - Timestamp
   - Delegation reason (from leader output)
3. **Human approval gate for sensitive operations.** A configurable list of operations require human approval even when delegated by a leader:
   - Merging to protected branches
   - Deploying to production
   - Modifying agent configs
   - Accessing secrets/environment variables
4. **Squad archiving cascade.** When a squad is archived:
   - All active tasks transfer to leader
   - No new tasks accepted
   - All members notified
5. **Leader rotation requires human approval.** Changing a squad leader cannot be done by an agent — only by a workspace member with admin role.

### Gate Test Checklist

- [ ] Leader cannot delegate to agent outside its squad
- [ ] Leader attempting to merge to `main` is blocked without human approval
- [ ] Archiving a squad cancels pending tasks and transfers active ones

### Current Aegis Coverage

Based on Themis security review (2026-05-22):

- No `Squad`, `squad`, or related types in `src/`. Feature code does not exist yet.
- ✅ **Audit trail** — structured audit logs for all API operations
- ✅ **Human approval gates** — permission system with approve/reject flow

**Verdict: ⏸️ NOT YET APPLICABLE** — #3973 is the spec issue. All 5 sub-requirements and 3 gate tests must pass when squad code ships.

---

## Requirement 4: No External File Storage Exfiltration Path

**Applies to:** All features

### Decision

Aegis is NOT introducing S3/external file storage for agents. The existing local storage model is sufficient.

### Hard Requirement

No feature PR may introduce:

- Agent write access to external storage (S3, GCS, Azure Blob, etc.)
- File upload endpoints that agents can call without human approval
- Artifact storage accessible outside the workspace boundary

If file storage is needed in the future, it will be a separate security-reviewed PR with its own threat model.

### Gate Test Checklist

- [ ] Grep assertion: no feature PR introduces `S3_`, `GCS_`, `AZURE_BLOB_` env vars in agent-executed code paths
- [ ] Grep assertion: no feature PR imports `aws-sdk`, `@google-cloud/storage`, `@azure/storage-blob` in agent-executed code paths

### Current Aegis Coverage

Based on Themis security review (2026-05-22):

```
grep -rn "S3_\|GCS_\|AZURE_BLOB_\|aws-sdk\|@aws-sdk\|@google-cloud/storage" src/ → zero hits (excluding tests)
```

- ✅ **No external storage** — agents work in local workDir only
- ✅ **WorkDir restriction** — `AEGIS_ALLOWED_WORK_DIRS` limits filesystem scope
- ✅ **No agent-writable file upload endpoints**

**Verdict: ✅ MET**

---

## Review Process

### Step 1: Feature PR Author — Self-Certification

Before requesting review, the PR author must complete the self-certification checklist:

1. Identify which requirements apply to your feature (see [Blocking Relationships](#blocking-relationships))
2. For each applicable requirement, provide evidence:
   - Gate test results (pass/fail with output)
   - Code references showing implementation
   - Design decisions with rationale
3. For requirements marked N/A, explain why the feature doesn't trigger them

### Step 2: Themis — Security Review

Themis reviews the self-certification against the codebase:

1. **Verify claims** — run gate tests independently, check code references
2. **Assess coverage** — determine if each requirement is met, partially met, or not met
3. **Identify gaps** — specific remediation required before approval
4. **Issue verdict** per requirement:
   - ✅ MET — no action needed
   - ⚠️ PARTIAL — specific gaps to address
   - ❌ NOT MET — blocking, must resolve before merge
   - ⏸️ N/A — not yet applicable (e.g., Req 3 before squad implementation)
5. **Publish findings** — comment on the PR with detailed assessment

Themis holds veto. A feature PR cannot merge without her approval on all applicable requirements.

### Step 3: Argus — Merge Gate Check

Argus includes the security gate in the standard merge review:

1. Verify Themis has approved all applicable requirements
2. Confirm gate tests pass in CI
3. Check for any new security-sensitive code paths not covered by the requirements
4. Merge only when all checks pass

### Review Timeline

| Step | Owner | SLA |
|------|-------|-----|
| Self-certification | PR author | Before review request |
| Security review | Themis | 24 hours from request |
| Merge gate | Argus | Standard review queue |

### Self-Certification Template

Feature PR authors should include this checklist in their PR description:

```markdown
### Security Gate (#3980)

**Applicable requirements:** Req X, Req Y (see [docs/security-multi-agent-requirements.md](docs/security-multi-agent-requirements.md))

- [ ] **Req 1 (Sandboxing):** [N/A | ✅ Evidence: ... | ⚠️ Gaps: ...]
  - Filesystem: [evidence]
  - Network: [evidence]
  - Env vars: [evidence]
  - CLI args: [evidence]
  - Gate tests: [pass/fail with output]
- [ ] **Req 2 (Identity):** [N/A | ✅ Evidence: ... | ⚠️ Gaps: ...]
  - Agent active check: [evidence]
  - Workspace access: [evidence]
  - Runtime health: [evidence]
  - Dispatch auth: [evidence]
  - Gate tests: [pass/fail with output]
- [ ] **Req 3 (Squad Scope):** [N/A | ✅ Evidence: ... | ⚠️ Gaps: ...]
  - Delegation boundary: [evidence]
  - Audit trail: [evidence]
  - Human approval gate: [evidence]
  - Archiving cascade: [evidence]
  - Leader rotation: [evidence]
  - Gate tests: [pass/fail with output]
- [ ] **Req 4 (No External Storage):** [N/A | ✅ Evidence: ...]
  - Grep assertion results: [output]
  ```

---

## Blocking Relationships

This issue **blocks** the following from merging without security review:

| Issue | Feature | Applicable Requirements |
|-------|---------|------------------------|
| #3970 | Task Queue | Req 1, 2, 4 |
| #3971 | Agent Profiles | Req 1, 2 |
| #3972 | Autopilots | Req 2, 4 |
| #3973 | Squads | Req 1, 2, 3, 4 |
| #3974 | Inbox | Req 2 |
| #3975 | Agent Chat | Req 2 |
| #3976 | Agent Skills | Req 1, 4 |
| #3978 | Comments & @Mentions | Req 2 |

---

## See Also

- [Security Best Practices](security-best-practices.md) — production hardening guide
- [Enterprise Security](enterprise/02-security.md) — security review
- [ADR-0019](adr/0019-session-ownership-authz.md) — session ownership model
- [ADR-0030](adr/0030-network-isolation-scope-by-deployment-tier.md) — network isolation scope
- [#3980](https://github.com/OneStepAt4time/aegis/issues/3980) — tracking issue

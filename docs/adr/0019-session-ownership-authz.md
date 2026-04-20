# ADR-0019: Explicit Session Ownership Authz on Action Routes

## Status
Proposed

## Context

Aegis identifies API keys with a role (`admin`, `operator`, `viewer`) and records `ownerKeyId` on sessions they create. However, action routes — `POST /v1/sessions/:id/send`, `/approve`, `/reject`, `/kill`, `/interrupt`, `/escape`, `/command`, `/bash` — currently rely on bearer-token authentication alone and do not verify that the caller owns (or is otherwise entitled to) the target session.

In a single-user deployment this is fine. In any shared deployment it means:

- Any valid `operator` key can interact with, kill, or approve prompts in any other operator's sessions.
- Audit attribution is correct (we record actor) but prevention is absent.
- Multi-tenancy (P1-1) cannot be layered on cleanly without this boundary.

Issue #1429 started the ownership plumbing; this ADR formalises the enforcement layer.

Referenced as **P0-1** in [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md).

## Decision

Enforce explicit ownership/authorization on every session-mutating route.

### Authorization rule (phase 1)

A request to an action route for session `S` is allowed iff:

1. The caller key role is `admin`, **or**
2. `S.ownerKeyId === caller.keyId`, **or**
3. The session has been explicitly shared with the caller via a share grant (phase 2 placeholder; not shipped in phase 1).

### Implementation

- Add `requireSessionOwnership()` helper in [src/routes/context.ts](../../src/routes/context.ts) alongside `requireRole()`.
- Apply to all session-mutating routes listed above. Read routes (`GET /v1/sessions/:id`, `/read`, `/transcript`, `/pane`, `/summary`, `/health`) continue to require role-level access until the multi-tenancy decision lands.
- Return `403 FORBIDDEN` with error code `SESSION_FORBIDDEN` and an audit entry.

### Configuration flag

Ship behind `AEGIS_ENFORCE_SESSION_OWNERSHIP` (default `true`) for one minor release to give deployments a one-line rollback if edge cases surface, then remove the flag.

### Audit

Emit audit records for both allowed and denied attempts with action `session.action.denied`/`session.action.allowed` so compliance reviewers can prove enforcement.

## Consequences

- **Pros:** closes the main silent-authz gap; prerequisite for multi-tenancy (P1-1) and granular RBAC (P0-6).
- **Cons:** existing integrations that assumed a shared pool of keys may need to adjust: either use one admin key or adopt the explicit share grant in phase 2.
- **Testing:** requires adding ownership bypass/denial tests to the existing `auth-bypass-*`/`session-ownership-*` files.

## Related

- Gap analysis: P0-1 in [00-gap-analysis.md](../enterprise/00-gap-analysis.md)
- Issue #1429 (ownership tracking groundwork)
- Companion ADRs: [ADR-0018](0018-openapi-spec-from-zod.md), [ADR-0020](0020-env-var-denylist.md)

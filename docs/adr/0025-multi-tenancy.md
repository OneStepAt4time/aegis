# ADR-0025: Multi-Tenancy Primitives

| Status  | Accepted |
|---------|----------|
| Date    | 2026-04-27 |
| Issue   | #1944 |

## Context

Aegis is moving into Phase 3 (team & early-enterprise). Multiple users sharing a single Aegis deployment need isolation: one tenant's sessions and audit records must not be visible to another tenant (unless the caller is an admin).

## Decision

### 1. Tenant ID on API keys

Add optional `tenantId` to `ApiKey`. When a key has a `tenantId`, every session created with that key inherits it. Keys without `tenantId` use the server default (`AEGIS_DEFAULT_TENANT_ID`, default: `"default"`).

### 2. Tenant ID on sessions

`SessionInfo.tenantId` is inherited from the creating key at session creation time. Sessions without `tenantId` (pre-existing) are visible to all callers (backward compatibility).

### 3. Tenant ID on audit records

`AuditRecord.tenantId` is stored with each audit log entry. Queries can filter by tenant. Pre-existing records without `tenantId` are visible to all callers.

### 4. Admin/master bypass

API keys with `role: 'admin'` and the master token do not have a `tenantId`. They bypass all tenant scoping and see all sessions/audit records across all tenants.

### 5. Config default

`AEGIS_DEFAULT_TENANT_ID` (default: `"default"`) sets the server-wide default tenant. Keys without an explicit `tenantId` inherit this at the application layer.

### 6. Defense in depth

Tenant scoping is applied at three layers:
- **Listing endpoints** (`GET /v1/sessions`, `/v1/sessions/history`, `/v1/sessions/stats`, `/v1/audit`): results filtered by caller's tenant
- **Individual access** (`requireOwnership`, `requireSessionOwnership`): cross-tenant access rejected with 403
- **Session creation**: `tenantId` inherited from authenticated key, not from request body

### 7. No edition flag

Consistent with ADR-0023, there is no `AEGIS_EDITION` flag. Multi-tenancy is available in the single MIT edition.

## Consequences

- **Backward compatible**: existing keys, sessions, and audit records without `tenantId` work unchanged.
- **Key creation API**: `POST /v1/auth/keys` accepts optional `tenantId`.
- **Migration**: no migration needed. Assign `tenantId` to keys as teams are onboarded.
- **Future**: tenant-level quotas, rate limits, and billing hooks are Phase 4 concerns.

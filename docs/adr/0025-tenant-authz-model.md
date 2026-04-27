# ADR-0025: Tenant-Aware Authorization Model

## Status
Proposed

## Context

ADR-0019 introduced explicit session ownership authorization, binding actions to the `ownerKeyId` of the creating API key. This works for single-tenant deployments but is insufficient when multiple external teams share one Aegis instance (Phase 3 goal).

Issue #1944 adds a `tenantId` field to API keys, sessions, and audit entries. Issue #1942 implements SSO/OIDC for dashboard login. Together these introduce a new trust boundary: **tenants must never see each other's data**.

Without a formal authorization model, the implementation risk is:
- Cross-tenant data leakage through API routes that filter by `ownerKeyId` but not `tenantId`.
- OIDC claims mapping to roles without tenant isolation — a user in Tenant A could be assigned admin in Tenant B.
- Audit entries leaking across tenants — one tenant's audit export includes another's.
- Workdir namespace collisions — two tenants using the same `workDir` path could interfere.

Referenced as **P1-1** in [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md).

## Decision

Layer tenant isolation on top of the existing key-role and session-ownership model. Tenancy is a **mandatory filter**, not an optional scope.

### Authorization hierarchy

```
Request → Tenant isolation → Role check → Session ownership → Permission check
```

Every layer must pass. Failure at any layer returns `403 FORBIDDEN`.

### 1. Tenant isolation (new — this ADR)

Every authenticated request carries a `tenantId` derived from one of:

- **API key**: `key.tenantId` (set at creation, immutable).
- **OIDC token**: `token.claims["aegis:tenant"]` or `token.claims["hd"]` (Google Workspace domain).
- **Dashboard session**: `session.claims["aegis:tenant"]` (set at OIDC login).

A request to any route is allowed **only if** the caller's `tenantId` matches the resource's `tenantId`. There is no "super-tenant" that sees everything — even admin keys are tenant-scoped.

### 2. System tenant

A reserved `tenantId = "_system"` exists for:
- Internal health/diagnostics endpoints.
- Server-side background tasks (pipeline cleanup, metrics aggregation).
- Initial setup before any tenant is created.

System-tenant keys can **not** access user-tenant resources.

### 3. Tenant scoping rules

| Resource | Tenant filter | Notes |
|----------|--------------|-------|
| Sessions | `session.tenantId == caller.tenantId` | Inherits from creating key |
| API keys | `key.tenantId == caller.tenantId` | Admin can list/create within own tenant |
| Audit entries | `audit.tenantId == caller.tenantId` | No cross-tenant audit visibility |
| Pipelines/templates | `resource.tenantId == caller.tenantId` | Or `null` (global, read-only for all) |
| Memory/state | `memory.tenantId == caller.tenantId` | Namespaced per tenant |
| Health/diagnostics | No filter | Unauthenticated or system-tenant only |

### 4. OIDC claim-to-tenant mapping

OIDC login flow (ADR-TBD for #1942) maps claims to tenant identity:

```
Priority:
1. Custom claim: aegis:tenant (explicit)
2. Google Workspace: hd claim (domain)
3. Entra ID: tid claim (tenant ID)
4. Fallback: email domain after @
```

If no tenant matches, the user is denied access (not auto-provisioned).

### 5. Tenant creation

- Only system-tenant admin keys can create new tenants.
- Tenant creation is an API call, not automatic from SSO login.
- This prevents tenant sprawl and ensures explicit provisioning.

## Consequences

- **Pros:** Clean isolation boundary for Phase 3 multi-tenancy; prevents cross-tenant data leakage at the authorization layer rather than relying on query filtering alone.
- **Cons:** All existing routes must be updated with tenant-scoped queries; global/admin views need explicit design for operators managing multiple tenants (Phase 4 consideration).
- **Migration:** Single-tenant deployments default to `tenantId = "default"` — all existing keys, sessions, and audit entries are retroactively assigned to this tenant on upgrade.
- **Testing:** Every route needs cross-tenant denial tests. Existing `auth-bypass-*` and `session-ownership-*` test files gain a `tenant-isolation-*` companion.

## Implementation notes for #1944

- Add `tenantId: string` (default `"default"`) to `ApiKey` type and `ApiKeyStore` schema.
- Add `tenantId: string` to session creation payload; inherit from creating key if not provided.
- Add `tenantId: string` to audit log entries.
- Add `requireTenantMatch()` middleware that runs **before** `requireRole()` and `requireSessionOwnership()`.
- Migration script: assign `"default"` to all existing keys/sessions/audit entries on first boot after upgrade.

## Related

- Gap analysis: P1-1 in [00-gap-analysis.md](../enterprise/00-gap-analysis.md)
- ADR-0019: [Session Ownership Authz](0019-session-ownership-authz.md) — parent authorization model
- Issue #1944: Multi-tenancy primitives
- Issue #1942: SSO/OIDC for dashboard
- Issue #1945: Workdir namespacing per tenant

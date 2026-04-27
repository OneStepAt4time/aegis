# ADR-0026: OIDC Trust Model for Dashboard SSO

## Status
Proposed

## Context

Issue #1942 implements SSO/OIDC login for the Aegis dashboard, supporting standard OIDC providers (Entra ID, Google Workspace, Okta, Keycloak, Authentik). ADR-0025 defined the tenant-aware authorization model that OIDC users must fit into. This ADR specifies the **trust model** — how Aegis validates OIDC tokens, maps claims to internal identities, and enforces session security.

Without a formal trust model, implementation risks include:
- Token substitution attacks — accepting tokens from untrusted IdPs.
- Claim injection — users forging roles or tenant IDs via manipulated JWT claims.
- Session fixation — replaying OIDC callbacks to hijack dashboard sessions.
- Missing token validation — accepting expired or revoked tokens.

Referenced as **P1-2** in [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md).

## Decision

### 1. OIDC Discovery

Aegis discovers provider metadata from the well-known endpoint:

```
GET {issuer}/.well-known/openid-configuration
```

The `issuer` is configured via `AEGIS_OIDC_ISSUER` (required). Aegis **never** hardcodes provider-specific endpoints. Discovery is performed once at startup and cached.

### 2. Token Validation

Every OIDC token (ID token and access token) must pass all checks:

| Check | Rule |
|-------|------|
| **Issuer** | `token.iss` must exactly match `AEGIS_OIDC_ISSUER` |
| **Audience** | `token.aud` must contain `AEGIS_OIDC_CLIENT_ID` |
| **Expiration** | `token.exp` must be in the future |
| **Not-before** | `token.nbf` must be in the past |
| **Signature** | Verified against JWKS from `{issuer}/.well-known/jwks.json` |
| **Nonce** | Auth callback nonce must match the one sent in the auth request (CSRF protection) |

**No token passes without all six checks.** There is no "lenient" mode.

### 3. Claim-to-Identity Mapping

After validation, claims are mapped to Aegis internal identity:

```
Aegis identity:
  userId:    token.sub          (stable, unique per user)
  email:     token.email        (optional, for display)
  name:      token.name         (optional, for display)
  tenantId:  mapped via priority chain (see ADR-0025 §4)
  role:      mapped via AEGIS_OIDC_ROLE_CLAIM (default: "viewer")
```

### 4. Role Mapping

OIDC users get their Aegis role from a configurable claim:

```
AEGIS_OIDC_ROLE_CLAIM — default: "aegis_role"
```

If the claim is missing or contains an unrecognized value, the user gets `viewer` (least privilege). Recognized values: `admin`, `operator`, `viewer`.

**Security rule:** OIDC claims never elevate a user beyond what the IdP asserts. Aegis does not have its own role override for OIDC users — the IdP is the source of truth for role assignment.

### 5. Dashboard Session Flow

```
1. User visits dashboard → redirected to IdP auth endpoint
2. IdP authenticates user → redirects back with authorization code
3. Aegis exchanges code for tokens at IdP token endpoint
4. Aegis validates ID token (§2)
5. Aegis maps claims to identity (§3-4)
6. Aegis creates a short-lived dashboard session (cookie-based)
7. Cookie: HttpOnly, Secure, SameSite=Strict, Max-Age=3600 (1 hour)
```

### 6. Session Security

- Dashboard sessions are **separate from API key sessions**. An OIDC login does not grant API access.
- Dashboard session tokens are opaque random strings (not JWTs) stored server-side.
- Session cookie: `HttpOnly` (no JS access), `Secure` (HTTPS only), `SameSite=Strict` (no CSRF via cross-site).
- Session lifetime: 1 hour, no refresh. User must re-authenticate.
- Logout: clear cookie + optionally call IdP end-session endpoint.

### 7. Provider Configuration

All OIDC config via environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `AEGIS_OIDC_ISSUER` | Yes | IdP issuer URL (e.g., `https://accounts.google.com`) |
| `AEGIS_OIDC_CLIENT_ID` | Yes | OAuth2 client ID registered with the IdP |
| `AEGIS_OIDC_CLIENT_SECRET` | Yes | OAuth2 client secret |
| `AEGIS_OIDC_ROLE_CLAIM` | No | Claim name for role mapping (default: `aegis_role`) |
| `AEGIS_OIDC_SCOPES` | No | Requested scopes (default: `openid profile email`) |
| `AEGIS_OIDC_REDIRECT_PATH` | No | Callback path (default: `/auth/callback`) |

**Secret handling:** `AEGIS_OIDC_CLIENT_SECRET` is loaded from environment only — never from config file, never logged, never included in error messages.

### 8. Multi-Provider Support (Phase 4 consideration)

This ADR covers a single IdP. Multiple IdPs (e.g., enterprise + contractor) require:
- Per-provider `tenantId` mapping.
- Discovery endpoint per provider.
- User disambiguation across providers.

Deferred to Phase 4. Phase 3 ships with one IdP.

## Consequences

- **Pros:** Standard OIDC flow, no provider-specific code, claims validated before identity mapping, least-privilege defaults, no session fixation risk.
- **Cons:** Single-IdP limit for Phase 3; no role override for OIDC users (IdP must be trusted to assign correct roles).
- **Migration:** When OIDC is disabled (no `AEGIS_OIDC_ISSUER`), dashboard falls back to the existing `AEGIS_AUTH_TOKEN` header-based auth. No breaking change.
- **Testing:** Must test: expired token rejection, issuer mismatch, audience mismatch, nonce mismatch, missing claims, unknown role values.

## Implementation notes for #1942

- Use `openid-client` npm package (standard, well-audited, supports PKCE).
- Implement PKCE (Proof Key for Code Exchange) — mandatory for public clients, recommended for confidential clients.
- Cache JWKS with 1-hour TTL and graceful rotation on key rollover.
- Rate-limit the callback endpoint to prevent token brute-force.
- Add OpenTelemetry spans for auth flow (login, callback, token exchange, validation).

## Related

- ADR-0025: [Tenant-Aware Authorization Model](0025-tenant-authz-model.md) — tenant mapping from OIDC claims
- ADR-0019: [Session Ownership Authz](0019-session-ownership-authz.md) — parent authorization model
- Issue #1942: SSO/OIDC for dashboard
- Issue #1943: OAuth2 device flow for CLI (depends on this ADR)
- RFC 6749: OAuth 2.0
- RFC 7636: PKCE
- OpenID Connect Core 1.0

# Scoping: OAuth2 Device Flow for CLI (`ag login`)

**Issue:** #1943 (item 3.7)
**Depends on:** #1942 (item 3.6 — SSO / OIDC for dashboard)
**Phase:** 3 — Team & Early-Enterprise
**Status:** NOT ACTIVE (do not start implementation)
**RFC reference:** [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)

---

## 1. Interface Design

### `ag login`

```
$ ag login
Authenticating via <IdP name>...

  To authenticate, visit:
    https://login.microsoftonline.com/.../deviceauth

  Enter code:  ABCD-EFGH

Waiting for authorization...
```

**Behaviour:**

1. Reads OIDC configuration from `AEGIS_OIDC_*` env vars (or `~/.aegis/config.yaml`). Fails with a clear message if OIDC is not configured.
2. Sends a device authorization request to the IdP's `device_authorization_endpoint`.
3. Prints the `verification_uri` (or `verification_uri_complete` if the IdP provides it) and the `user_code`.
4. Polls the IdP's `token_endpoint` with the `device_code` until the user completes browser auth, times out, or an error occurs.
5. On success: stores tokens (see section 3), prints confirmation with the resolved identity (e.g. `Logged in as alice@example.com (admin)`).
6. On failure: prints a human-readable error and exits with code 1.

**Flags:**

| Flag | Purpose |
|------|---------|
| `--server URL` | Override the Aegis server URL (defaults to `http://localhost:9100`) |
| `--provider NAME` | Override the IdP label for display (defaults to value from config) |
| `--json` | Output machine-readable JSON (for scripting) |
| `--no-open` | Do not attempt to open the browser automatically |

**Exit codes:** 0 = success, 1 = auth failed / timeout, 2 = config error (OIDC not set up).

### `ag logout`

```
$ ag logout
Revoking tokens... done
Logged out (alice@example.com).
```

**Behaviour:**

1. Reads stored tokens from `~/.aegis/auth.json`.
2. Sends a revocation request to the IdP's `revocation_endpoint` (if discoverable). Best-effort — failures are logged but do not block logout.
3. Deletes the token file (or clears the entry for the current server).
4. Prints confirmation.

**Flags:**

| Flag | Purpose |
|------|---------|
| `--server URL` | Logout from a specific server only |
| `--all` | Logout from all servers (delete entire `auth.json`) |
| `--json` | Machine-readable output |

### `ag whoami`

```
$ ag whoami
alice@example.com  admin  (token expires in 47m)
```

**Behaviour:**

1. Reads stored tokens. Exits with code 1 if not logged in.
2. If the access token is expired but a refresh token exists, silently refreshes and updates storage.
3. Prints identity claim (`email` / `preferred_username` / `sub`), mapped role, and token expiry.

**Why this command:** Essential for debugging auth state and for scripts that need to verify authentication before proceeding.

### CLI integration point

The existing CLI dispatch in `src/cli.ts` uses manual `argv[0]` matching. Add a new `auth` subcommand group:

```
ag login           →  argv[0] === 'login'
ag logout          →  argv[0] === 'logout'
ag whoami          →  argv[0] === 'whoami'
```

No argument parsing framework needed — follow the existing pattern. Each handler goes in `src/commands/` alongside `init.ts` and `doctor.ts`.

---

## 2. OAuth2 Device Flow Protocol (RFC 8628)

The full flow, mapped to Aegis components:

```
┌──────────┐                    ┌──────────┐                 ┌─────────┐
│  ag login │                    │  Aegis    │                 │   IdP   │
│  (CLI)    │                    │  server   │                 │         │
└─────┬─────┘                    └─────┬─────┘                 └────┬────┘
      │                                │                            │
      │  1. Read OIDC config           │                            │
      │  (AEGIS_OIDC_ISSUER, etc.)     │                            │
      │                                │                            │
      │  2. GET <issuer>/.well-known/openid-configuration          │
      │───────────────────────────────────────────────────────────>│
      │                                │                            │
      │  3. Discovery response         │                            │
      │  (device_authorization_endpoint, token_endpoint,           │
      │   revocation_endpoint, etc.)   │                            │
      │<───────────────────────────────────────────────────────────│
      │                                │                            │
      │  4. POST device_authorization_endpoint                     │
      │     (client_id, scope, resource=audience)                  │
      │───────────────────────────────────────────────────────────>│
      │                                │                            │
      │  5. { device_code, user_code,  │                            │
      │       verification_uri,        │                            │
      │       expires_in, interval }   │                            │
      │<───────────────────────────────────────────────────────────│
      │                                │                            │
      │  6. Print code + URL to user   │                            │
      │                                │                            │
      │  7. User opens browser ──────────────────────────────────> │
      │                                │       (user authenticates  │
      │                                │        at IdP, enters code)│
      │                                │                            │
      │  8. POST token_endpoint        │                            │
      │     (grant_type=urn:ietf:params:oauth2:grant-type:device_code,
      │      device_code, client_id)   │                            │
      │───────────────────────────────────────────────────────────>│
      │                                │                            │
      │  9a. { authorization_pending } │                            │
      │     → wait `interval` seconds, retry                        │
      │                                │                            │
      │  9b. { slow_down }             │                            │
      │     → increase `interval` by 5s, retry                      │
      │                                │                            │
      │  9c. { access_token, id_token, │                            │
      │        refresh_token,          │                            │
      │        expires_in }            │                            │
      │<───────────────────────────────────────────────────────────│
      │                                │                            │
      │  10. Validate id_token (JWT    │                            │
      │      signature via JWKS,       │                            │
      │      issuer, audience, nonce)  │                            │
      │                                │                            │
      │  11. Map claims → role          │                            │
      │      (per AEGIS_OIDC_ROLE_MAP) │                            │
      │                                │                            │
      │  12. Store tokens              │                            │
      │      (see section 3)           │                            │
      │                                │                            │
      │  13. Print "Logged in as ..."  │                            │
```

**Key design decisions:**

- **Discovery happens client-side.** The CLI fetches `.well-known/openid-configuration` directly from the IdP. This avoids requiring the Aegis server to proxy IdP requests and means the CLI works even if the server is not yet running (useful for bootstrap).
- **`client_id` is public.** Device flow is designed for public clients. The `client_id` is not a secret — it is configured via `AEGIS_OIDC_CLIENT_ID` and stored in plaintext config. No `client_secret` is needed or used.
- **`resource` parameter.** Some IdPs (Entra ID) require `resource` or `scope` to include the target API audience. This maps to `AEGIS_OIDC_AUDIENCE`.
- **PKCE is NOT used.** RFC 8628 does not use PKCE — the device code itself is the verifier, exchanged over a direct TLS channel to the IdP. Do not add PKCE to the device flow.

---

## 3. Token Storage Design

### File location

```
~/.aegis/auth.json
```

This follows the existing convention where `~/.aegis/` holds `keys.json`, `config.yaml`, etc.

### File permissions

Mode `0o600` (owner read/write only), enforced on every write. Use the existing `secureFilePermissions()` helper from `src/file-utils.ts`.

### Format

```jsonc
{
  // Keyed by server origin so multi-server is supported from day one
  "http://localhost:9100": {
    "idp": "https://login.microsoftonline.com/tenant-id/v2.0",
    "identity": {
      "sub": "aaaaaaaa-1111-2222-3333-444444444444",
      "email": "alice@example.com",
      "name": "Alice Engineer"
    },
    "tokens": {
      "access": "eyJ...",          // JWT — opaque to Aegis
      "refresh": "0.ARo...",       // opaque refresh token
      "id_token": "eyJ...",        // JWT — validated at login time, not re-validated after
      "expires_at": 1745678400,    // Unix epoch seconds
      "scope": "openid profile email"
    },
    "role": "admin",
    "obtained_at": "2026-04-26T10:00:00Z"
  }
}
```

**Design rationale:**

- **Keyed by server origin** — a single developer may use multiple Aegis deployments (local, staging, production). Each gets its own token set.
- **`identity` is cached** — extracted from `id_token` at login time so `ag whoami` does not need to parse the JWT on every invocation.
- **`refresh` is the critical secret** — the access token is short-lived (typically 1h) and the refresh token is the long-lived credential. Both must be protected.
- **No encryption at rest** — file-level permissions (`0o600`) are the protection mechanism. Adding encryption would require a master password or keychain integration, adding complexity. The `0o600` approach is consistent with how `~/.aegis/keys.json` already stores sensitive material. Revisit if enterprise users require it (Phase 4+).
- **No keychain integration in initial implementation** — `keytar` / `libsecret` require native bindings and differ across platforms. File-based storage with strict permissions is sufficient for Phase 3. Document as a Phase 4 enhancement.

### Token refresh

When the CLI (or any Aegis client using the stored tokens) encounters an expired access token:

1. Read `auth.json`, check `expires_at`.
2. If expired and `refresh` token exists: `POST token_endpoint` with `grant_type=refresh_token`.
3. On success: update `access`, `expires_at`, optionally `refresh` (rotation), write back to `auth.json` with `0o600`.
4. On failure (refresh token revoked/expired): delete the entry from `auth.json`, print re-login message, exit with code 1.

### Concurrent access

Multiple `ag` invocations may race on `auth.json`. Use `fcntl(F_SETLK)` advisory locking via `fs.open()` + `flock`-style locking. In practice, collisions are rare (short-lived CLI commands), but the write path must be atomic: write to `auth.json.tmp`, then `fs.rename()` to `auth.json`.

---

## 4. Polling Mechanism and Timeout Handling

### Polling loop

Per RFC 8628 §3.3-3.5:

```
interval = response.interval || 5        // seconds
max_elapsed = 900                         // 15 minutes hard cap
elapsed = 0

while elapsed < max_elapsed:
    response = POST token_endpoint(device_code, client_id)

    switch response.error:
        case undefined (success):
            return response.tokens
        case "authorization_pending":
            sleep(interval)
            elapsed += interval
            continue
        case "slow_down":
            interval += 5
            sleep(interval)
            elapsed += interval
            continue
        case "expired_token":
            fail("Code expired. Run ag login again.")
        case "access_denied":
            fail("Authorization denied by user.")
        default:
            fail("Unexpected error: " + response.error_description)
```

### Timeout values

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `max_elapsed` | 900s (15 min) | RFC 8628 recommends respecting `expires_in` from the device auth response. Cap at 15 min as a safety floor. Use `min(expires_in, 900)`. |
| Default `interval` | 5s | RFC 8628 §3.2 default. Most IdPs return this explicitly. |
| `slow_down` increment | +5s | Per RFC 8628 §3.5. Cumulative. |
| HTTP timeout per poll | 10s | Network-level timeout for each token endpoint request. |
| Total HTTP retries | 3 | On network errors (not OAuth errors), retry with exponential backoff (2s, 4s). |

### User feedback during polling

Display a spinner or dots to indicate activity. On each poll cycle, optionally update a status line. On `slow_down`, print "Server requested slower polling..." so the user does not think the CLI is hung.

### Cancellation

Handle `SIGINT` (Ctrl+C) gracefully: print "Login cancelled", do NOT delete any existing tokens (this is a new login attempt, not a logout), exit with code 130.

---

## 5. Dependency Mapping on #1942

Issue #1942 (SSO / OIDC for dashboard) provides the OIDC infrastructure that `ag login` consumes. Here is what must exist from #1942 before #1943 can function:

### Hard dependencies (must land first)

| #1942 Deliverable | Why #1943 Needs It |
|--------------------|-------------------|
| `AEGIS_OIDC_ISSUER` env var | CLI uses this to construct the discovery URL and validate `id_token` issuer claim |
| `AEGIS_OIDC_CLIENT_ID` env var | CLI sends this as the public client identifier in device auth + token requests |
| `AEGIS_OIDC_AUDIENCE` env var | CLI sends this as the `resource` parameter (Entra ID) or `audience` in token request |
| OIDC discovery endpoint validation | The server-side validation logic for `.well-known/openid-configuration` must be established so the CLI can reuse the same config parsing |
| JWKS fetching + caching | The CLI needs to validate `id_token` signatures. If #1942 builds a JWKS fetcher, reuse it. If not, #1943 must build one. |
| Claim-to-role mapping (`AEGIS_OIDC_ROLE_MAP`) | Both dashboard and CLI need to map OIDC claims to Aegis roles (`admin`, `operator`, `viewer`). The mapping logic should be shared, not duplicated. |
| Token validation middleware in `AuthManager` | The server must accept OIDC-issued access tokens as valid credentials (alongside existing API keys). #1943's stored tokens will be used in API requests — the server must validate them. |

### Soft dependencies (can be worked around)

| #1942 Deliverable | Workaround if Not Ready |
|--------------------|------------------------|
| `AEGIS_OIDC_SCOPES` default | Hardcode `openid profile email` as default, allow override |
| IdP-specific quirks (Entra ID `resource` param) | Build a known-quirks map in the CLI, or accept that some IdPs need extra config |
| Dashboard logout/revocation | `ag logout` can implement revocation independently |
| Token introspection endpoint | CLI validates JWTs locally (JWKS), no introspection needed |

### Shared code boundaries

Both #1942 and #1943 should share:

- `src/services/auth/oidc-config.ts` — env var parsing, config validation, discovery response types
- `src/services/auth/jwks.ts` — JWKS fetcher, cache, JWT signature verification
- `src/services/auth/claim-mapper.ts` — claim-to-role mapping logic
- `src/services/auth/token-validation.ts` — access token validation (JWT or introspection)

These modules are owned by #1942 but must be designed for CLI consumption from the start. The #1943 PR should import from them, not fork them.

---

## 6. Security Considerations

### Token protection

| Threat | Mitigation |
|--------|------------|
| Token file read by another user | `0o600` permissions on `auth.json`. Check on every read; warn if permissions are too permissive. |
| Token file read by another process (same user) | Acceptable threat model — same-user processes can already ptrace/keylog. Equivalent to `~/.ssh/` and `~/.netrc`. |
| Refresh token in process memory | Zero the Buffer after use. Avoid logging tokens. Redact from error reporting. |
| Token file on shared/NFS mount | Warn at login if home directory appears to be on NFS (`stat -f` check). Recommend `AEGIS_AUTH_DIR` override to local path. |

### Token revocation

- `ag logout` sends `POST revocation_endpoint` per [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) with the `refresh_token` and `access_token` (best-effort, both if available).
- Not all IdPs support revocation. If the IdP's discovery response lacks `revocation_endpoint`, skip revocation and just delete the local file. Print a warning: "IdP does not support token revocation. Tokens may remain valid until expiry."
- `ag logout --all` deletes `auth.json` entirely.

### Replay prevention

- Access tokens are short-lived (typically 1h). Replay window is small.
- The server-side validation (from #1942) should check `exp`, `nbf`, `iat`, and `aud` claims on every request.
- For high-security deployments, #1942 may implement token binding or nonce validation. #1943 does not need to add replay prevention beyond standard JWT validation.

### Client ID exposure

- Device flow is a public client flow. The `client_id` is not secret.
- However, `client_id` should be documented as specific to the Aegis deployment, not a global hard-coded value. Each deployment registers its own OAuth application with their IdP.

### Nonce

- Include a `nonce` parameter in the device authorization request if the IdP supports it (some don't for device flow).
- Validate `nonce` in the `id_token` response if present.
- If the IdP does not support nonce in device flow (some omit it per RFC 8628), skip nonce validation for device flow specifically. The `device_code` binding provides equivalent protection.

### Redirect URI

- Device flow does not use a redirect URI. Do not configure one. Some IdPs require a redirect URI in the app registration regardless — use a placeholder like `http://localhost`.

---

## 7. Test Strategy

### Unit tests

| Test area | File | Key scenarios |
|-----------|------|---------------|
| OIDC config parsing | `src/services/auth/oidc-config.test.ts` | Valid config, missing required fields, invalid issuer URL |
| Discovery response handling | `src/commands/login.test.ts` | Parse discovery, extract endpoints, handle missing `device_authorization_endpoint` |
| Device auth request | `src/commands/login.test.ts` | Build correct request body, handle IdP errors (`invalid_client`, `invalid_scope`) |
| Polling logic | `src/commands/login.test.ts` | `authorization_pending` → retry, `slow_down` → increase interval, `expired_token` → fail, success |
| Token validation | `src/services/auth/token-validation.test.ts` | Valid JWT, expired JWT, wrong issuer, wrong audience, invalid signature |
| Claim-to-role mapping | `src/services/auth/claim-mapper.test.ts` | Map groups → admin, no matching claim → deny, multiple roles → highest |
| Token storage | `src/commands/login.test.ts` | Write `auth.json`, verify `0o600`, atomic write, read back, multi-server |
| Token refresh | `src/commands/whoami.test.ts` | Expired access → refresh → update file, refresh fails → delete entry |
| Logout / revocation | `src/commands/logout.test.ts` | IdP supports revocation → revoke + delete, IdP does not → delete with warning |

**Testing approach:** Mock HTTP calls to the IdP using `nock` or `fetch-mock`. Do not hit real IdPs in unit tests.

### Integration tests

| Test area | How | Requires |
|-----------|-----|----------|
| Full device flow | Run `ag login` against a mock IdP server (Fastify route that mimics discovery + device auth + token endpoint). Assert `auth.json` is created with correct content. | Mock IdP |
| Token usage in API request | After `ag login` stores a token, make an authenticated request to the Aegis server. Assert the server validates the JWT and returns the correct role. | #1942 token validation |
| Token refresh flow | Configure mock IdP to return expired access tokens. Run `ag whoami`. Assert refresh happens and new token is stored. | Mock IdP |
| Logout end-to-end | `ag logout` after login. Verify `auth.json` is cleaned up and revocation was called. | Mock IdP with revocation |
| Multi-server | Login to two different servers. `ag whoami --server X` returns correct identity for each. | Two mock IdPs |

### IdP compatibility tests (CI matrix)

Test against mocked versions of each target IdP's discovery + device flow quirks:

| IdP | Known quirk to test |
|-----|-------------------|
| Entra ID | Requires `resource` parameter instead of/alongside `scope`; returns `verification_uri_complete` |
| Google | Limited device flow support (Workspace accounts only); uses `scope` not `resource` |
| Okta | Standard OIDC; may return `verification_uri_complete` |
| Keycloak | Standard OIDC; fully configurable |
| Authentik | Standard OIDC; similar to Keycloak |

Each test case is a mock IdP response fixture, not a real IdP connection. Real IdP testing is manual QA.

---

## 8. Implementation Phases

### Phase A — Can start before #1942 lands

These items have zero dependency on the server-side OIDC infrastructure and can be developed and tested in isolation.

| Item | Deliverable | Depends on |
|------|-------------|------------|
| A1. OIDC config module | `src/services/auth/oidc-config.ts` — parse `AEGIS_OIDC_*` env vars, validate, export typed config | Nothing |
| A2. Discovery client | `src/services/auth/oidc-discovery.ts` — fetch + parse `.well-known/openid-configuration`, cache in memory | A1 |
| A3. JWKS client | `src/services/auth/jwks.ts` — fetch JWKS, cache, verify JWT signature | A2 |
| A4. Claim mapper | `src/services/auth/claim-mapper.ts` — map OIDC claims to Aegis roles | A1 |
| A5. Token file store | `src/services/auth/token-store.ts` — read/write `auth.json` with atomic writes and permission enforcement | Nothing |
| A6. Device flow client | `src/commands/login.ts` — device auth request + polling loop + token validation + storage | A1–A5 |
| A7. `ag logout` | `src/commands/logout.ts` — revocation + file cleanup | A5 |
| A8. `ag whoami` | `src/commands/whoami.ts` — read tokens, refresh if needed, print identity | A5 |
| A9. CLI dispatch | Wire `login`, `logout`, `whoami` into `src/cli.ts` | A6–A8 |
| A10. Unit tests | All unit tests from section 7 | A1–A9 |

**Estimated scope:** ~800–1000 lines of new code across `src/services/auth/` and `src/commands/`.

### Phase B — Requires #1942 to be merged

These items integrate the CLI auth with the server-side token validation.

| Item | Deliverable | Depends on |
|------|-------------|------------|
| B1. Shared module alignment | Refactor A1–A4 to be the canonical source, consumed by both CLI and server | #1942 merged |
| B2. Integration tests | Token stored by `ag login` is accepted by the Aegis server | B1, #1942 |
| B3. ADR | Write ADR for OAuth2 device flow trust model (CLI as public client, token lifecycle, claim mapping) | B1 |
| B4. Documentation | User-facing docs: how to register an OAuth app with each supported IdP, how to configure `AEGIS_OIDC_*`, `ag login` / `ag logout` / `ag whoami` usage | A9, B1 |
| B5. IdP compatibility fixtures | Mock IdP response fixtures for Entra ID, Google, Okta, Keycloak, Authentik | B2 |

---

## Environment Variables (Summary)

All OIDC env vars are prefixed `AEGIS_OIDC_` and shared with #1942:

| Variable | Required | Description |
|----------|----------|-------------|
| `AEGIS_OIDC_ISSUER` | Yes | IdP issuer URL (e.g. `https://login.microsoftonline.com/tenant-id/v2.0`) |
| `AEGIS_OIDC_CLIENT_ID` | Yes | OAuth2 client ID registered with the IdP |
| `AEGIS_OIDC_AUDIENCE` | No | Expected audience for tokens (defaults to `client_id`) |
| `AEGIS_OIDC_SCOPES` | No | Space-separated scopes (defaults to `openid profile email`) |
| `AEGIS_OIDC_ROLE_MAP` | No | JSON mapping from claims to roles (e.g. `{"groups.admin":"admin","groups.operator":"operator"}`). Default: no mapping, deny access. |
| `AEGIS_AUTH_DIR` | No | Override directory for `auth.json` (defaults to `~/.aegis/`) |

---

## New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `jose` | JWT parse, verify, JWKS — de-facto standard, no native bindings, ESM-compatible | ~50KB |
| `open` | Open browser for `verification_uri_complete` (optional UX) | ~5KB |

Do NOT add: `openid-client` (heavy, designed for server-side auth-code flow), `passport` (server middleware, not CLI), `keytar` (native bindings, cross-platform pain).

---

## Open Questions

1. **Device flow support by IdP** — Not all IdPs support device flow equally. Google's device flow is limited to Workspace accounts. Should `ag login` support an alternative flow (e.g., auth code + localhost redirect) as a fallback? **Recommendation:** No. Device flow is the CLI standard. If an IdP does not support it, the user falls back to API keys (which already work). Document this clearly.

2. **Refresh token rotation** — Some IdPs (Okta, Authentik) rotate refresh tokens on each use. The CLI must handle this: update `auth.json` after every refresh. Is this acceptable? **Recommendation:** Yes. Atomic write to `auth.json` on every refresh is fine — the file is small and writes are fast.

3. **Multiple concurrent logins** — Should `ag login` on an already-authenticated server replace the existing token or prompt? **Recommendation:** Replace silently. The user explicitly chose to re-login. Print "Replacing existing session for <server>".

4. **`AEGIS_OIDC_ROLE_MAP` syntax** — Dot-notation claim paths (`groups.admin`) vs. JSONPath vs. JMESPath? **Recommendation:** Dot-notation. Simple, covers 90% of cases. No expression language.

5. **Server-side token validation for CLI tokens** — Should the Aegis server validate the JWT locally (JWKS) or introspect at the IdP? **Recommendation:** Local JWT validation. Faster, no IdP dependency on every request. Introspection is a future option for high-security mode.

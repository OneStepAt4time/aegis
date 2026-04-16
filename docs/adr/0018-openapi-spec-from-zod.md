# ADR-0018: OpenAPI 3.1 Spec Generated from Zod Schemas

## Status
Proposed

## Context

Aegis exposes 45+ REST endpoints under `/v1/` plus SSE and WebSocket surfaces. Today the API is documented in three places that drift independently:

1. Hand-written Markdown in [docs/api-reference.md](../api-reference.md)
2. Zod schemas in [src/validation.ts](../../src/validation.ts), [src/api-contracts.ts](../../src/api-contracts.ts), and per-route files under [src/routes/](../../src/routes/)
3. Route handlers in [src/server.ts](../../src/server.ts) and [src/routes/](../../src/routes/)

There is **no machine-readable OpenAPI contract**. This blocks:

- Auto-generated SDKs for Python, Go, Rust, and external TypeScript consumers.
- Contract tests that catch breaking changes before merge.
- API-gateway integration (Kong, Tyk, APIM) that most enterprise deployments require.
- IDE tooling (Swagger UI, Postman import, Stoplight) used by evaluators.

The gap was identified as **P0-4** in [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md).

## Decision

Generate an OpenAPI 3.1 document from the existing Zod schemas using a single toolchain and publish it at both build time and runtime.

### Toolchain

- Use `@asteasolutions/zod-to-openapi` (or `zod-openapi`) to describe each route's request body, query params, path params, and response envelope alongside the existing Zod schema.
- Register route descriptions centrally via the [RouteContext](../../src/routes/) pattern so route modules stay the source of truth.
- Emit `openapi.yaml` at the repo root on build; serve the same document at `GET /v1/openapi.json` (and optionally `GET /v1/docs` as Swagger UI).

### CI contract test

Add a CI job that:

1. Builds the server.
2. Starts it against an ephemeral port.
3. Fetches `/v1/openapi.json`.
4. Diffs it against the committed `openapi.yaml` — fails if out of sync.

### Scope

In scope: REST endpoints and SSE event envelope types.
Out of scope (phase 1): MCP tool schemas (already described via MCP SDK), WebSocket binary framing.

## Consequences

- **Pros:** eliminates doc drift, unlocks SDK generation (P2-5), enables gateway deployments, provides a normalized deprecation-header model (P2-4).
- **Cons:** every route must register an OpenAPI descriptor; small per-route tax. Zod → OpenAPI conversion has edge cases for `z.passthrough()` and recursive schemas that we must handle explicitly (notably in hook-body validation, see Issue #665).
- **Migration:** existing hand-written [docs/api-reference.md](../api-reference.md) becomes narrative prose; generated OpenAPI becomes the contract.

## Related

- Gap analysis: P0-4 in [00-gap-analysis.md](../enterprise/00-gap-analysis.md)
- Companion ADRs: [ADR-0019](0019-session-ownership-authz.md), [ADR-0020](0020-env-var-denylist.md)

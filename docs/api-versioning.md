# API Versioning Policy

> Issue #1956 — Formal versioning and deprecation for the Aegis REST API.

## Overview

Aegis uses **URL-path versioning** (`/v1/`, `/v2/`) with HTTP headers to signal
deprecation and sunset timelines. This document defines what triggers a major
version, the support window for deprecated endpoints, and the header semantics
consumers must handle.

## Current version

| Prefix | Status | Since |
|--------|--------|-------|
| `/v1/` | Active | v1.0.0 |
| Legacy (`/health`, `/sessions`, etc.) | Deprecated | Sunset 2027-01-01 |
| `/v2/` | Planned (stub only) | — |

### ACP major cutover exception

The Phase 3.5 ACP backend cutover is a maintainer-approved major package
release plan that keeps the REST namespace at `/v1`. The exception is documented
in [ACP Major Cutover Release Plan](acp-major-cutover-release-plan.md): the
release removes tmux/window/pane contracts from the existing control-plane API
instead of introducing a parallel `/v2/acp` backend namespace.

This exception is intentionally narrow. Future unrelated breaking API changes
should continue to introduce a successor namespace unless maintainers approve a
specific exception before public contract PRs merge.

## Versioning rules

### What triggers a major version bump

A new major API version (`/v2/`, `/v3/`, etc.) is introduced only when a
breaking change is required. Breaking changes include:

- Removing an endpoint.
- Removing or renaming a required request field or response field.
- Changing a field's type incompatibly.
- Changing authentication semantics.
- Changing error response shapes.

The following are **not** breaking changes and ship within the current version:

- Adding new endpoints.
- Adding new optional request fields.
- Adding new response fields (clients must ignore unknown fields).
- Adding new enum values (clients must handle unknown values).
- Changing the order of fields in a JSON response.

### Support window

- Each major version is supported for **at least 12 months** after its
  successor is released.
- During the support window, deprecated endpoints receive bug fixes but no new
  features.
- After the support window ends, deprecated endpoints may return `410 Gone`.

## Deprecation headers

All deprecated endpoints emit the following HTTP headers on every response:

| Header | Format | Example | Description |
|--------|--------|---------|-------------|
| `Deprecation` | `true` | `true` | RFC 8594 — signals the endpoint is deprecated |
| `Sunset` | HTTP-date | `Thu, 01 Jan 2027 00:00:00 GMT` | RFC 8594 — date after which the endpoint may be removed |
| `X-API-Deprecated` | Free text | `Use /v1/health instead` | Human-readable migration hint (non-standard) |

All `/v1/` responses also include:

| Header | Format | Example |
|--------|--------|---------|
| `X-Aegis-API-Version` | Integer | `1` |

### Consumer responsibilities

API consumers **must**:

1. Check for `Deprecation: true` on every response.
2. Read the `Sunset` header to plan migration before the deadline.
3. Follow `X-API-Deprecated` for the replacement endpoint.
4. Ignore unknown response fields (forward-compatible).

## Legacy (unversioned) routes

Before versioning was introduced, Aegis registered some endpoints at both
`/v1/...` and an unversioned alias (e.g. `/health`, `/sessions`). These
aliases are now **deprecated** and emit deprecation headers. They will be
removed on **2027-01-01**.

Consumers must migrate to the `/v1/` equivalents:

| Deprecated path | Replacement |
|-----------------|-------------|
| `GET /health` | `GET /v1/health` |
| `GET /sessions` | `GET /v1/sessions` |
| `POST /sessions` | `POST /v1/sessions` |
| `GET /sessions/{id}` | `GET /v1/sessions/{id}` |
| `DELETE /sessions/{id}` | `DELETE /v1/sessions/{id}` |

(All routes registered via `registerWithLegacy()` are affected.)

## Migration to v2

When v2 is planned, the following steps will occur:

1. **Announcement** — `docs/api-v2-migration.md` is published with a full
   changelog and migration guide.
2. **v2 stub** — `GET /v2/` returns metadata (already exists).
3. **Parallel operation** — v1 and v2 endpoints coexist for at least 12 months.
4. **v1 deprecation** — v1 endpoints emit `Deprecation` and `Sunset` headers.
5. **v1 removal** — After the sunset date, v1 endpoints return `410 Gone`.

### v2 migration template

When v2 is planned, copy `docs/api-v2-migration-template.md` to
`docs/api-v2-migration.md` and fill in the concrete changes. The template
covers every section consumers need to migrate successfully.

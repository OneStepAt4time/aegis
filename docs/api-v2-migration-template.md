# Migrating from API v1 to v2

> **Template** — Copy this file to `docs/api-v2-migration.md` and fill in the
> concrete breaking changes when v2 is planned. Do not edit this template.

## Overview

<!-- Describe what changed in v2 and why. Example:
Aegis v2 introduces multi-tenancy primitives (tenantId), a new SessionStore
abstraction, and removes legacy unversioned routes. This guide walks you
through every breaking change.
-->

## Breaking changes

### Removed endpoints

| Endpoint | Status | Replacement |
|----------|--------|-------------|
| `GET /health` | Removed (was deprecated) | `GET /v1/health` |
| `GET /sessions` | Removed (was deprecated) | `GET /v1/sessions` |
| `POST /sessions` | Removed (was deprecated) | `POST /v1/sessions` |
| `GET /sessions/{id}` | Removed (was deprecated) | `GET /v1/sessions/{id}` |
| `DELETE /sessions/{id}` | Removed (was deprecated) | `DELETE /v1/sessions/{id}` |

<!-- Add any v1 endpoints removed in v2 below this line. -->

### Changed request fields

| Endpoint | Field | v1 | v2 | Migration |
|----------|-------|----|----|-----------|
| <!-- endpoint --> | <!-- field --> | <!-- old --> | <!-- new --> | <!-- action --> |

### Changed response fields

| Endpoint | Field | v1 | v2 | Migration |
|----------|-------|----|----|-----------|
| <!-- endpoint --> | <!-- field --> | <!-- old --> | <!-- new --> | <!-- action --> |

### New required fields

| Endpoint | Field | Type | Description |
|----------|-------|------|-------------|
| <!-- endpoint --> | <!-- field --> | <!-- type --> | <!-- why it's required --> |

## Step-by-step migration

### 1. Update base URL

```bash
# Before (v1)
curl http://localhost:9100/v1/sessions

# After (v2) — update the version prefix
curl http://localhost:9100/v2/sessions
```

### 2. Handle new required fields

<!-- Per-endpoint instructions for fields that became required in v2.
Example:
```bash
# v1 — tenantId was optional
curl -X POST http://localhost:9100/v1/sessions -d '{"workDir": "/tmp"}'

# v2 — tenantId is required
curl -X POST http://localhost:9100/v2/sessions -d '{"workDir": "/tmp", "tenantId": "acme"}'
```
-->

### 3. Update authentication

<!-- If authentication semantics changed (e.g., token format, header name),
document the migration here.
-->

### 4. Update error handling

<!-- If error response shapes changed, show before/after examples.
Example:
```json
// v1 error
{ "error": "Session not found" }

// v2 error
{ "code": "SESSION_NOT_FOUND", "message": "Session not found", "requestId": "..." }
```
-->

### 5. Verify migration

```bash
# Health check (should return v2)
curl -I http://localhost:9100/v2/health | grep X-Aegis-API-Version

# Verify no deprecated headers on v2 responses
curl -I http://localhost:9100/v2/sessions | grep Deprecation
# Should return nothing — v2 endpoints are not deprecated
```

## Deprecation timeline

| Milestone | Date | What happens |
|-----------|------|--------------|
| v2 announcement | <!-- YYYY-MM-DD --> | `docs/api-v2-migration.md` published |
| v2 release | <!-- YYYY-MM-DD --> | v2 endpoints available alongside v1 |
| v1 deprecation headers | <!-- YYYY-MM-DD --> | v1 endpoints emit `Deprecation` + `Sunset` |
| v1 end of support | <!-- YYYY-MM-DD + 12 months --> | v1 endpoints receive bug fixes only |
| v1 removal | <!-- YYYY-MM-DD + 24 months --> | v1 endpoints return `410 Gone` |

## Automated migration script

```bash
#!/usr/bin/env bash
# migrate-v1-to-v2.sh — Update API calls from v1 to v2
# Usage: ./migrate-v1-to-v2.sh /path/to/your/codebase

set -euo pipefail

SEARCH_DIR="${1:-.}"
V1_BASE="${V1_BASE:-http://localhost:9100/v1}"
V2_BASE="${V2_BASE:-http://localhost:9100/v2}"

echo "Migrating API calls from ${V1_BASE} to ${V2_BASE}..."

# Find and replace versioned URLs
find "$SEARCH_DIR" -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.sh" \) \
  -exec sed -i "s|${V1_BASE}|${V2_BASE}|g" {} +

# Report files changed
CHANGED=$(git diff --name-only 2>/dev/null || echo "see output above")
echo "Files updated:"
echo "$CHANGED"

echo ""
echo "Review the changes, then run your test suite to verify."
```

## Need help?

- [API Reference](./api-reference.md) — current v1 endpoint documentation
- [API Versioning Policy](./api-versioning.md) — full versioning rules
- [GitHub Discussions](https://github.com/OneStepAt4time/aegis/discussions) — ask questions

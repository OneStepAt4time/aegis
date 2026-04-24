# Contributing to Aegis Documentation

This guide covers how to contribute documentation to Aegis. For full contribution guidelines (setup, commit conventions, PR process, development workflow), see the main [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Documentation Structure

```
docs/
├── getting-started.md      # Quick start for new users
├── contributing.md        # This file — docs contribution guide
├── advanced.md            # Advanced features (pipelines, Memory Bridge, templates)
├── api-reference.md       # Full REST API reference (auto-generated from OpenAPI)
├── api-examples.md        # curl examples for every endpoint
├── api-rate-limiting.md   # Rate limiting configuration
├── webhook-retry.md       # Webhook retry logic
├── deployment.md           # Deployment and operations guide
├── remote-access.md       # Accessing Aegis remotely
├── mcp-tools.md           # MCP tools reference
├── architecture.md        # System architecture
├── contributing.md        # This file
├── onboarding.md          # Team onboarding guide
├── enterprise-onboarding.md # Enterprise deployment guide
└── migration-guide.md    # Upgrading from v0.5.x to v0.6.x
```

---

## Doc Contribution Workflow

### Before You Start

1. Read [CONTRIBUTING.md](../CONTRIBUTING.md) — setup, branching, PR process
2. Read the [SOUL.md](https://github.com/OneStepAt4time/aegis/blob/develop/SOUL.md) — documentation philosophy
3. Check the [open docs issues](https://github.com/OneStepAt4time/aegis/issues?q=is%3Aissue+is%3Aopen+label%3Adocs) on GitHub

### Branch Naming

```
docs/<topic>           # New documentation for a topic
docs/fix/<issue>     # Fix documentation bug
docs/update/<feature> # Update docs for a feature change
```

Examples:
- `docs/api-rate-limiting`
- `docs/fix/getting-started-heading`
- `docs/update/session-templates`

### Writing Docs

**Style rules (from SOUL.md):**

- **30-Second Rule** — any README reader understands what Aegis does in 30 seconds, or the doc is wrong
- **Example-Driven** — every feature has a runnable example
- **Always In Sync** — docs ship with the feature in the same release
- **English Only** — no exceptions in public artifacts
- **Release Gate** — no release promotes to `main` until docs PR is merged

**Markdown conventions:**

```markdown
## Sentence case headings

- Use bullet lists for steps
- Code blocks for commands: ```bash
- JSON for API examples: ```json
- Tables for comparisons and reference data
```

**API documentation:**

When documenting API endpoints, always verify against the source:

```bash
# Extract all endpoints from OpenAPI spec
grep "path:" src/routes/openapi.ts | sed "s/.*path: '//;s/'.*//"
```

Every endpoint needs:
- `curl` example with auth headers
- Request body schema (when applicable)
- All response codes documented
- Edge cases and error responses

### Testing Examples

All `curl` examples must be tested against a running Aegis instance:

```bash
# Verify the server is running
curl http://localhost:9100/v1/health

# Test your example
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/tmp/test"}'
```

### Commit Convention

Use the `docs:` prefix for all documentation commits:

```bash
git commit -m "docs: add API rate limiting guide"
git commit -m "docs: fix duplicate heading in getting-started"
git commit -m "docs: update session templates API reference"
```

---

## PR Process

1. **Open PR** targeting `develop` branch (never `main`)
2. **PR title** must start with `docs:` prefix
3. **Description** must explain what changed and why
4. **Review** — tag @AG Argus for review
5. **Merge** — after approval, Ema merges

### PR Description Template

```markdown
## Summary

Brief description of what this PR documents.

## What's changed

- Added X section covering Y
- Fixed Z incorrect description
- Updated example to reflect current API

## Verification

- [ ] All curl examples tested against localhost:9100
- [ ] No broken links
- [ ] No placeholder text ("TODO", "example.com")
- [ ] Follows SOUL.md documentation philosophy
```

---

## Common Documentation Tasks

### Adding a New API Endpoint

1. Find the endpoint in `src/routes/openapi.ts`
2. Extract method, path, request/response schemas
3. Add curl example to `docs/api-reference.md`
4. Add working example to `docs/api-examples.md`
5. Test the curl command locally

### Updating an Environment Variable

1. Find current default in `src/config.ts`
2. Update the table in `docs/deployment.md`
3. If breaking change, add to `docs/migration-guide.md`

### Adding a New Feature Document

1. Create the file under `docs/`
2. Add to the docs structure section above
3. Link from relevant parent docs (e.g., `getting-started.md`, `README.md`)
4. Write the 30-second summary first

---

## Quick Reference

| Task | Command |
|------|---------|
| New doc branch | `git worktree add ../wt/docs-foo origin/develop -b docs/foo` |
| Run docs locally | `npm run docs` generates TypeDoc output |
| Test curl locally | `curl http://localhost:9100/v1/health` |
| Check links | `grep -r "http" docs/*.md | grep -v "https://github.com"` |

---

## Getting Help

- **Docs issues:** https://github.com/OneStepAt4time/aegis/labels/docs
- **Scribe (docs owner):** @Scribe on Discord
- **General contributing:** [CONTRIBUTING.md](../CONTRIBUTING.md)

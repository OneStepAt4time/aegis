# ADR-0016: Release-please with GitHub App Token

Status: Accepted
Date: 2026-04-10

## Context

Aegis uses [release-please](https://github.com/googleapis/release-please) for automated changelog generation and semantic versioning. However, release-please requires authentication to create releases and tags on GitHub.

Two authentication options exist:
1. **Personal Access Token (PAT)** — tied to a individual user, expires, has user permissions
2. **GitHub App token** — tied to an application, has installation permissions, longer-lived

## Decision

Use **GitHub App token** for release-please automation.

### Why Not PAT?

- PATs expire and require manual renewal
- PATs carry user permissions that may be too broad
- If the user leaves, the PAT must be regenerated
- PATs cannot be scoped to a specific repository in a way that's visible to reviewers

### Why GitHub App?

- Token is associated with the Aegis app, not a user
- Permissions are installation-scoped (read/write on specific repos)
- Token auto-refreshes before expiry
- Audit trail shows "Aegis" as the actor, not an individual

### Configuration

```bash
# Set in CI environment
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_TOKEN=$(gh auth token --app github-app)
```

release-please uses the token to:
- Create tags on release branches
- Create GitHub releases with changelog
- Update CHANGELOG.md via PR

## Consequences

Pros:
- Reliable automation without manual token management
- Better audit trail — releases attributed to app, not user
- No token expiration during long-running release processes

Cons:
- GitHub App setup requires admin access to the GitHub organization
- App must be installed on the repository
- App private key must be kept secure (use secrets management)

## Enforcement

- Never commit GitHub App private keys to repository
- Store app credentials in CI secrets, not environment files
- Rotate app keys annually or immediately if compromised

# PR Requirements

## Quality Gate (mandatory before opening PR)

```bash
npx tsc --noEmit    # must pass
npm run build       # must pass
npm test            # must pass
```

## PR Body (required fields)

Every PR must include:

```markdown
## Aegis version
**Developed with:** vX.Y.Z   ← get from: curl -s http://localhost:9100/v1/health | jq .version
```

## Scope

Keep PRs minimal and focused. One concern per PR. If a PR touches more than 20 files, split it.

## Review

All PRs require review before merge. Argus is the validation steward.

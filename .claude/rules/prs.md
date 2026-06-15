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

## Bot-authored PRs (Path (b) Fallback)

Bot-authored PRs (e.g., `aegis-gh-agent[bot]`, `dependabot[bot]`, or per-agent
Apps once registered) cannot self-approve on GitHub. The
[Path (b) Fallback in CONTRIBUTING.md](../../CONTRIBUTING.md#path-b-fallback-boss-approves-via-cli-on-bot-authored-prs)
documents the lane convention Ema uses to unblock such PRs:

```bash
# Ema runs this from their machine (NOT a bot, NOT a CI runner)
gh pr review --approve <PR_NUMBER>
```

The structural fix (a dedicated reviewer App / PAT) is tracked in
[#4725](https://github.com/OneStepAt4time/aegis/issues/4725). Until that lands,
Path (b) is the documented lane for human approval clicks on bot-authored PRs.
Branch protection's `required_approving_review_count: 1` is still enforced
(Argus pre-stages the review, Ema's click counts as the second eye).

**When you're submitting a bot-authored PR:**

1. Open the PR with the bot identity (the bot must be the author, not a
   human proxy).
2. Wait for CI green + Argus's pre-stage review.
3. Request an explicit human approval click in `#aegis-devs` with
   `@<Ema's Discord ID>` — do **not** assume the bot can self-approve.
4. Once the human approves, the PR is mergeable per the standard flow.

**When you're reviewing a bot-authored PR:**

- Bot-authored PRs follow the same review bar as human-authored ones
  (Functional Code Gate, evidence template, CI green).
- The approval step is split: Argus does the technical LGTM, Ema (or
  another authorized human) does the approval click. See
  [Path (b) in CONTRIBUTING.md](../../CONTRIBUTING.md#path-b-fallback-boss-approves-via-cli-on-bot-authored-prs)
  for the full rationale.

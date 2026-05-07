# Docs Walk-Through Runbook

## Overview

The daily docs walk-through runs automated checks against 8 documentation pages to catch stale references, dead links, broken code blocks, missing images, and heading hierarchy issues.

## Running Manually

```bash
cd scripts/docs-walkthrough
./run.sh                  # Install deps + run checks
npm test                  # Human-readable summary table
npm run test:json         # Machine-readable JSON output
npm run test:verbose      # Full findings with file:line details
```

Exit code 0 = all clean, exit code 1 = issues found.

## Daily Cron (OpenClaw)

```bash
openclaw cron create \
  --name "daily-docs-walkthrough" \
  --schedule "0 06 * * *" \
  --model "zai/glm-5.1" \
  --task "Run the daily docs walk-through: cd /home/bubuntu/projects/aegis/scripts/docs-walkthrough && npm test. If any issues are found, post a summary to #aegis-devs. Do NOT file GitHub issues automatically — report findings and let Scribe triage."
```

### Cron Output Format

Post to `#aegis-devs`:

**Clean run:**
> 📝 Docs walk-through clean ✅ (8 pages, 0 issues)

**Issues found:**
> 📝 Docs walk-through found 3 issues:
> - `api-reference.md`: 1 dead link (ADR-0025)
> - `getting-started.md`: 2 heading hierarchy skips
> 
> Full report: `npm run test:verbose` in `scripts/docs-walkthrough/`

## Triage Process

When the walk-through reports issues:

1. **Scribe** reviews the findings
2. Classify each finding:
   - **Fix now** — stale legacy runtime/psmux references, broken links, wrong code examples
   - **Known/acceptable** — historical references in migration docs, intentional heading skips
   - **False positive** — legacy runtime mentioned in "no legacy runtime required" context
3. Open a docs PR for valid findings within 24 hours
4. Close the triage loop by posting the PR link to `#aegis-devs`

## Pages Checked

| Page | File | Focus |
|------|------|-------|
| Getting Started | `docs/getting-started.md` | Prerequisites, install steps, quick start |
| ACP Migration Guide | `docs/acp-migration-guide.md` | No stale pre-ACP references in current guidance |
| API Reference | `docs/api-reference.md` | All endpoints listed, no dead anchor links |
| MCP Tools | `docs/mcp-tools.md` | Tool names match code, parameter tables complete |
| Deployment Guide | `docs/deployment.md` | Docker/env examples valid, config vars match source |
| Windows Setup | `docs/windows-setup.md` | No legacy runtime/psmux refs, PowerShell-valid commands |
| Troubleshooting | `docs/troubleshooting.md` | Error messages match current backend |
| BYO LLM | `docs/byo-llm.md` | Provider list current, env var names match source |

## Checks Explained

| Check | What it flags | Severity |
|-------|--------------|----------|
| Dead Links | `[text](path)` where target file doesn't exist | High |
| Stale References | `legacy runtime`, `psmux`, `windowId`, `capture-pane` outside historical context | High |
| Code Block Validation | `bash -n` syntax errors in fenced code blocks | Medium |
| Broken Images | `![alt](path)` where file doesn't exist | Medium |
| Heading Hierarchy | Skipped heading levels (h1 → h3 without h2) | Low |

## Maintenance

- **Adding a page:** Edit `PAGES` array in `walkthrough.ts`
- **Adding a check:** Add a new function in `checks.ts`, register in `runChecks()`
- **Updating stale ref patterns:** Edit `STALE_PATTERNS` in `checks.ts`
- **Ignoring false positives:** Add file-specific exceptions in `checks.ts`

# Daily Docs Walk-Through — OpenClaw Cron + Playwright

**Status:** Plan approved, implementation pending post-ACP-cutover

## 1. Infrastructure

- **Trigger:** OpenClaw cron job, daily at 06:00 Rome time
- **Runtime:** Isolated sub-agent (`runtime="subagent"`)
- **Playwright:** Chromium via `npx playwright install chromium`
- **Docs server:** Booted locally per run, killed after walk-through

## 2. Pages to Test (8)

| Page | What to verify |
|------|----------------|
| Getting Started | Prerequisites match reality, install steps work, code blocks valid |
| ACP Migration Guide | No stale tmux references, env vars current, examples parse |
| API Reference | All endpoints listed, no 404s on anchor links |
| MCP Tools | Tool names match code, parameter tables complete |
| Deployment Guide | Docker compose examples valid, env vars match config.ts |
| Windows Setup | No tmux/psmux references, commands are PowerShell-valid |
| Troubleshooting | Error messages match current backend, fixes accurate |
| BYO LLM | Provider list current, env var names match source |

## 3. Automated Checks Per Page

- **Dead links:** Crawl all `<a href>` anchors, verify they resolve (no 404s on internal links)
- **Stale references:** `grep` rendered HTML for `tmux`, `psmux`, `windowId`, `windowName`, `paneCommand`, `capture-pane` — flag any that aren't explicitly "no longer required"
- **Code block validation:** Extract fenced code blocks, verify bash commands have valid syntax (`bash -n`), verify `curl` commands have proper flags
- **Broken images:** Check all `<img src>` resolve to actual files
- **Heading hierarchy:** Verify no skipped heading levels (h1 → h3 without h2)

## 4. Issue Filing

- **On failure:** GitHub issue with template:
  - Title: `docs: [page] — [what's wrong]`
  - Body: page URL, specific finding, suggested fix
  - Labels: `documentation`, `bug`, `good first issue`
- **On success:** Post one-line summary to `#aegis-devs` — "Docs walk-through clean ✅ (8 pages, 0 issues)"
- **Rate limit:** Max 1 issue per page per run (avoid spam)

## 5. Cron Configuration

```
openclaw cron create \
  --name "daily-docs-walkthrough" \
  --schedule "0 06 * * *" \
  --model "zai/glm-5.1" \
  --task "Run the daily docs walk-through: boot docs server, walk all pages in the test list, check for dead links, stale tmux references, broken code blocks, and missing images. File GitHub issues for problems. Post summary to #aegis-devs."
```

## 6. Implementation Notes

- Playwright scripts live in `scripts/docs-walkthrough/` in the repo
- Screenshots saved to `scripts/docs-walkthrough/screenshots/` for visual diffing
- The sub-agent needs `gh` CLI access for issue filing
- Windows-specific pages tested with `--browser webkit` if available
- Estimated runtime: ~2 minutes for full walk-through

## 7. Future Enhancements

- Screenshot baseline diffing (catch UI drift in dashboard docs)
- Spelling/grammar check via `cspell`
- API example validation (run curl commands against a live Aegis instance)
- Multi-language docs coverage check (i18n pages)

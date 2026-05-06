# Docs Walk-Through

Automated daily checks for Aegis documentation.

## What it checks

Every doc page is scanned for 5 issues:

| Check | What it does |
|-------|-------------|
| **Dead Links** | Finds all `[text](path)` links, verifies the target file exists |
| **Stale References** | Flags `tmux`, `psmux`, `windowId`, `windowName`, `paneCommand`, `capture-pane` without historical context |
| **Code Block Validation** | Validates all `bash`/`shell` fenced code blocks with `bash -n` |
| **Broken Images** | Finds all `![alt](path)` references, verifies the file exists |
| **Heading Hierarchy** | Verifies no skipped heading levels (h1 → h3 without h2) |

## Pages checked

1. Getting Started
2. ACP Migration Guide
3. API Reference
4. MCP Tools
5. Deployment Guide
6. Windows Setup
7. Troubleshooting
8. BYO LLM

## Usage

```bash
cd scripts/docs-walkthrough

# Install and run
./run.sh

# Or manually
npm install
npm test              # Human-readable table
npm run test:json     # Machine-readable JSON
npm run test:verbose  # Verbose with all findings
```

## Exit codes

- **0** — All checks passed
- **1** — One or more issues found

## Integration

Designed to run as a daily cron job or CI step. The `--json` output is structured for automated consumption.

---
name: documentation-overhaul
description: Complete documentation overhaul — missing files, outdated content, undocumented features
status: active
created: 2026-04-14T19:04:00Z
---

# PRD: Documentation Overhaul

## Problem
8 dashboard features shipped today with ZERO documentation. Critical files missing (CONTRIBUTING, SECURITY, DEPLOYMENT). Getting-started.md outdated. This is not enterprise-grade.

## Missing Files (Priority Order)
1. **CONTRIBUTING.md** — how to contribute, worktree rules, PR process, code style
2. **SECURITY.md** — security policy, reporting vulnerabilities, auth model
3. **DEPLOYMENT.md** — production deployment, Docker, systemd, env vars
4. **CHANGELOG.md** — release history (or link to GitHub releases)

## Outdated Files
1. **getting-started.md** — no worktree mention, no theme toggle, no keyboard shortcuts
2. **dashboard.md** — missing 8 features shipped today
3. **api-reference.md** — needs audit for new/changed endpoints

## Undocumented Features (shipped today)
- Theme toggle (dark/light) — #1816
- Keyboard shortcuts — #1780
- Breadcrumb navigation — #1807
- CSV export — #1791
- Sparkline charts — #1785
- Toast notifications — #1796
- Session search/filter — #1777
- Empty states — #1789

## Acceptance Criteria
- All 4 missing files created
- All 8 undocumented features documented
- getting-started.md updated with worktree workflow
- dashboard.md updated with all features
- Every shipped feature has corresponding documentation

## Related Issues
- #1811 — theme toggle (needs docs)
- #1777 — session search (needs docs)

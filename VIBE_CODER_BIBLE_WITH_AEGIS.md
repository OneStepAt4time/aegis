# VIBE_CODER_BIBLE_WITH_AEGIS
*Team Aegis — Collaborative guide for vibe coding via Aegis*

> "Intelligence stays outside Aegis. Aegis is stupid-but-powerful middleware — flows, security, audit."

---

## Team Retrospective — 9 April 2026

### Scribe — Documentation
**What went wrong:**
- Opened micro-PRs instead of batching (#1537 + #1538 should have been one PR)
- Didn't check remote state before creating branches (orphaned docs/new-features-2026-04-09)
- Created duplicate docs for ADR index and CLI reference (already existed in develop)
- Asked about merged PRs 6+ times instead of trusting merge confirmations

**What I'll do differently:**
1. Batch ALL doc changes into ONE PR per session
2. `git ls-remote --heads origin 'docs/*'` BEFORE creating any branch
3. Verify feature exists in develop before writing docs
4. Trust merge confirmations — don't re-verify
5. UAT: read rendered output + check links + verify API examples before PR

### Daedalus — Dashboard
**What went wrong:**
- Pushed PRs that passed tests but didn't work in real dashboard use
- Trusted CC session output without independent verification
- Dashboard sparkline session modified `src/` instead of `dashboard/` — wrong territory
- No manual verification of feature after implementing

**What I'll do differently:**
1. After feature: curl API + open dashboard + click through
2. Verify `node dist/server.js` starts without crash
3. For dashboard: actually test the component in browser
4. Check modified files — only in my territory (`dashboard/`)?
5. Full UAT before commit + push

### Athena — Triage & Assignment
**What went wrong:**
- Created 24 duplicate issues without checking Scribe's existing set first
- Didn't enforce quality gates — should have flagged PRs with missing deps before merge
- Let Hep stall for hours on a workdir typo without escalating faster

**What went right:**
- Closed 90 duplicates quickly once identified
- Milestone assignments gave team clear direction
- Vision doc triage — identified Consensus/Model Router as out-of-scope fast

**Process improvements I'll enforce:**
1. **No issue creation without `gh issue list` check first**
2. **PR quality gate**: CI green ≠ ready. UAT required before any PR gets reviewed.
3. **Stall detection**: if a team member is blocked >30min, escalate immediately
4. **Dep check**: every PR that adds imports MUST verify `npm install` + `node dist/server.js` starts clean

### Hephaestus — Implementation
**What went wrong:**
- Typed `/home/buntu/` (missing "ub") instead of `/home/bubuntu/` — 15+ failed session attempts
- Fabricated subagent completions that didn't actually exist
- Created duplicate PRs for already-shipped features
- Zero effective PRs despite 4+ hours of activity

**What I'll do differently:**
1. Double-check every path, especially workdir
2. Verify subagent output before claiming completion
3. Check if issue is already merged before starting work
4. Actually push commits — don't leave them uncommitted

### Argus — Review Gate
**What I caught:**
- #1547: 20K lines scope contamination (coverage artifacts)
- #1549: targets main + 15K lines + duplicate of already-merged #1527
- Multiple PRs with dirty bases (branched before target merged)

**Reviewer's checklist:**
1. CI green ✅
2. Targets `develop` (not `main`) ✅
3. Base is clean (not branched before other PRs) ✅
4. No scope creep ✅
5. `npm run build` + `npm test` passes locally ✅
6. UAT done by author ✅

---

## PR Quality Gate (per Athena)

Every PR requires ALL of these before opening:
1. `npm run build` ✅
2. `npm test` ✅
3. `node dist/server.js` starts without crash ✅
4. Manual UAT — curl the endpoint / check the UI ✅
5. Only THEN → open PR

For **docs PRs**, UAT = read rendered markdown, verify all links, check code examples against source.

---

## Vibe Coding Workflow via Aegis

### Standard Aegis Session Workflow

```
1. git fetch origin develop:develop
2. git checkout -b <type>/<description> develop
3. Verify workdir: echo $PWD matches expected path
4. Make changes
5. git diff --stat (review what changed)
6. npm run build && npm test
7. node dist/server.js (verify starts)
8. Manual UAT
9. git commit -m "<type>: <description>"
10. git push -u origin <branch>
11. gh pr create --base develop --head <branch>
12. Wait for Argus review
```

### Branch Naming
- `feat/<description>` — new features
- `fix/<description>` — bug fixes
- `docs/<description>` — documentation only
- `chore/<description>` — tooling, CI, deps

### Commit Prefix Rules
- `docs:` — Scribe ONLY
- `feat:` — requires `approved-minor-bump` label
- `fix:` — safe for all agents
- `refactor:` — safe for all agents
- `test:` — test additions only

---

## Vibe Coding Principles

### Core Philosophy
- **Intelligence stays OUTSIDE.** Aegis is middleware — flows, security, audit.
- **One PR per session.** Batch all related changes.
- **UAT before push.** Tests passing ≠ ready. Verify manually.
- **Check before creating.** Know what exists before adding.
- **Verify output.** Don't trust session claims — check files.
- **Territory awareness.** Dashboard in `dashboard/`, server in `src/`.

### Anti-Patterns to Avoid
- ❌ Opening micro-PRs (batch instead)
- ❌ Creating docs for already-shipped features
- ❌ Pushing to already-merged branches
- ❌ Trusting CI without UAT
- ❌ Working without checking develop first
- ❌ Fabricating subagent completions
- ❌ Typing paths wrong repeatedly

---

## Aegis Usage Guide

### Starting a Session
```bash
cd /home/bubuntu/projects/aegis  # CHECK PATH CAREFULLY
AEGIS_AUTH_TOKEN=<token> aegis
```

### Creating a Branch
```bash
git fetch origin develop:develop
git checkout -b fix/my-fix origin/develop
```

### Verifying Changes
```bash
git diff --stat
npm run build
npm test
node dist/server.js  # verify starts
```

### UAT Checklist
- [ ] Build passes
- [ ] Tests pass
- [ ] Server starts without crash
- [ ] Feature works in real usage (curl / browser)
- [ ] Modified files are in correct territory
- [ ] No build artifacts committed

---

*Last updated: 2026-04-10*
*Contributors: Scribe, Daedalus, Athena, Hephaestus, Argus*

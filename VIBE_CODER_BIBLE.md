# VIBE_CODER_BIBLE_WITH_AEGIS
*Collaborative guide — team Aegis*

---

## Scribe's Section — Documentation via Aegis

### How I Work

1. **Read before writing** — Always read SOUL.md, USER.md, MEMORY.md, and today's memory notes before starting
2. **Check develop first** — `git fetch origin develop:develop` + `git log --oneline develop | head -20` to see what's already merged
3. **One PR per session** — Batch all related doc changes into a single branch
4. **Verify against source** — Code examples must match actual API signatures from `src/*.ts`
5. **UAT before PR** — Read the final rendered doc, check every link, verify every code example

### My Aegis Workflow

```
1. git fetch origin develop:develop
2. git checkout -b docs/<topic> develop
3. Make changes
4. git diff --stat (review what changed)
5. git commit -m "docs: <description>"
6. git push -u origin docs/<topic>
7. gh pr create --base develop --head docs/<topic>
8. Wait for Argus review
```

### Common Mistakes to Avoid

- **Don't** open micro-PRs — batch changes
- **Don't** create docs for features already in develop
- **Don't** push to merged branches
- **Don't** ask about merged PRs — trust the merge confirmation
- **Do** check `git ls-remote --heads origin 'docs/*'` before creating branches
- **Do** read the actual source code before documenting an API

### Flags I Use
- `--dry-run` for git push verification
- `gh pr diff` to review before opening PR
- `gh pr view <n> --json state,mergedAt` to check status without posting

---

*[Other agents: add your sections below]*

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

## Hephaestus's Section — Implementation via Aegis

### How I Work
1. **Verify workdir ONCE** — `pwd` + `git status` before ANY command
2. **Verify 10M times** before pushing — check every diff, every file
3. **UAT mandatory** — run the actual feature, don't trust tests alone
4. **Perfect before PR** — if it doesn't work perfectly, keep working

### My Aegis Workflow
```
1. pwd (verify /home/bubuntu/projects/aegis)
2. git fetch origin develop
3. git checkout -b fix/<issue> develop
4. Implement with CC
5. git diff --stat
6. npm run build
7. npm test
8. node dist/server.js (verify starts)
9. Manual UAT — curl the endpoint
10. git push
11. gh pr create
```

### Common Mistakes to Avoid
- **DON'T** type `/home/buntu/` — it's `/home/bubuntu/`
- **DON'T** trust subagent "done" claims — verify git status yourself
- **DON'T** open PR if `npm run build` fails
- **DON'T** skip manual UAT — tests ≠ working software

### Flags I Use
- `git status` before every command
- `git log --oneline -5` to verify branch state
- `gh pr diff` to review before push

---

## Argus's Section — Review via Aegis

### Review Standards
1. **CI green ≠ ready** — verify the PR actually solves the problem
2. **Diff >500 lines** → immediate REQUEST_CHANGES
3. **server.ts + dashboard together** → flag scope split
4. **Wrong branch (main)** → immediate CLOSE
5. **Require UAT evidence** in PR body before reviewing

### What I Check
- Does it actually solve the described issue?
- Are there imports that need `npm install`?
- Does `node dist/server.js` start without crash?
- Is scope contamination present?

### New Review Gate
```
Before approving ANY PR:
□ npm run build ✅
□ npm test ✅
□ node dist/server.js starts ✅
□ Manual UAT evidence in PR body ✅
□ Diff <500 lines (or justified) ✅
□ Correct branch (develop, not main) ✅
```

### What Went Wrong This Sprint
- Approved code Ema had to fix manually (auth flow, dashboard login)
- Caught scope contamination too late (#1547, #1549)
- Didn't escalate Hep's stall fast enough

### What I'll Change
- "Tests passing ≠ working software" — verify manually
- Wrong branch → immediate CLOSE, no review
- >500 lines → REQUEST_CHANGES without reading full diff

---

## Daedalus's Section — Dashboard Development via Aegis

### How I Work
1. **After npm test** — actually run the dashboard and click through
2. **Verify end-to-end** — API call → component renders → data shows correctly
3. **No rush to PR** — if something feels incomplete, keep working
4. **Test error states** — 404, empty data, loading states

### My Aegis Workflow
```
1. git fetch origin develop
2. git checkout -b feat/<feature> develop
3. Implement with CC
4. npm run build
5. npm test
6. node dist/server.js
7. Open dashboard — click through the feature
8. curl API endpoint — verify JSON response
9. git push
10. gh pr create
```

### Common Mistakes to Avoid
- **DON'T** trust CC session output without verifying
- **DON'T** push before manually testing the dashboard
- **DON'T** skip error state testing
- **DON'T** call it done if "tests pass" — UAT required

### What UAT Means for Dashboard
- API endpoint returns correct JSON
- Dashboard renders the data
- Error states show gracefully
- Empty states handled

---

## Athena's Section — Triage & Coordination via Aegis

### Issue Management
1. **No issue creation without `gh issue list`** — always search first
2. **Every issue needs a milestone** — no orphan issues
3. **Stall detection** — if team member blocked >30min, escalate to Ema

### PR Quality Gate (Non-Negotiable)
Every PR requires ALL before opening:
```
□ npm run build ✅
□ npm test ✅
□ node dist/server.js starts without crash ✅
□ Manual UAT — curl endpoint / check UI ✅
□ Only THEN → open PR
```

### Dependency Check
Every PR that adds imports MUST verify:
```
□ npm install completes
□ node dist/server.js starts clean
□ No missing dependencies
```

### What Went Wrong
- Created 24 duplicate issues without checking existing set
- Didn't flag PRs with missing deps (nodemailer crash)
- Let Hep stall 4+ hours without escalating

### What I'll Change
- `gh issue list` check before creating ANY issue
- PR quality gate enforced before review request
- Stall >30min → immediate escalation

---

## Vibe Coding Principles (from roadmap.sh + team experience)

### Core Philosophy
- **Vibe coding** = coding with AI where you describe the feeling/vibe of what you want
- AI handles implementation details; human verifies correctness
- **Trust but verify** — AI makes mistakes, human must check

### Golden Rules
1. **UAT over tests** — manual testing > automated tests
2. **Perfect before PR** — if it doesn't work, keep working
3. **Verify 10M times** — check every diff, every file, every endpoint
4. **Own your code** — don't trust "done" claims from subagents or CC sessions
5. **Scope minimal** — one feature per PR, not five

### Anti-Patterns to Avoid
- Pushing without UAT ("tests pass = done")
- Micro-PRs (batch everything)
- Skipping manual verification
- Trusting AI output without checking
- Working in wrong branch (develop, NOT main)
- Typing wrong paths (/home/buntu/ vs /home/bubuntu/)

### Tools & Commands
```
# Verify workdir
pwd && git status

# Verify build
npm run build && npm test

# Verify server starts
node dist/server.js

# Manual UAT
curl -X POST http://localhost:9100/v1/auth/verify \\
  -H "Content-Type: application/json" \\
  -d '{"token":"aegis-master-token-2026"}'

# Check remote branches
git ls-remote --heads origin 'docs/*'
git ls-remote --heads origin 'fix/*'

# PR quality gate
gh pr create --base develop
```

### Signs You're Doing It Right
- You can explain what every line does
- You tested it manually before opening PR
- Build + tests pass locally
- No "I think it works" — you KNOW it works
- PR is small and focused

---

## Scribe — Documentation Rules

### My Workflow
1. Read SOUL.md, USER.md, MEMORY.md, today's notes before starting
2. `git fetch origin develop:develop` + `git log --oneline develop | head -10` — check what's merged
3. One PR per session — batch all doc changes
4. Verify API examples against actual `src/*.ts` signatures
5. UAT: read rendered markdown, check all links, verify code examples

### Docs Anti-Patterns
- ❌ Creating docs for features already in develop
- ❌ Opening micro-PRs (batch instead)
- ❌ Pushing to already-merged branches
- ❌ Not checking `git ls-remote --heads origin 'docs/*'` before branching
- ❌ Committing build artifacts (docs/api/, dist/)

### Docs Quality Gate
Before every PR:
- [ ] Read the rendered file in the PR diff
- [ ] Verify every code example matches actual API
- [ ] Check every link resolves
- [ ] Confirm no build artifacts committed
- [ ] `gh pr diff` review before opening

### Key Commands for Docs
```bash
# Check if branch exists
git ls-remote --heads origin 'docs/*'

# Check what's recently merged
git fetch origin develop:develop
git log --oneline develop | head -10

# Verify API signature
grep -n "endpoint\|route\|POST\|GET" src/server.ts | head -20
```

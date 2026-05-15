# Claude Code Prompting Best Practices — Hephaestus

_Lessons learned from 1 week of dogfooding Aegis with Aegis._

---

## Core Principles

### 1. Superpowers Skills First
Every CC session should start with a superpowers skill:
- **Brainstorming**: for features/complex issues
- **Writing-plans**: for implementation planning
- **Using Git Worktrees**: for isolation

The skill creates structure, validates context, and prevents scope creep.

### 2. Issue URL Always
Every prompt MUST include the GitHub issue URL:
```
URL: https://github.com/OneStepAt4time/aegis/issues/XXX
```
CC can fetch additional context, comments, linked PRs.

### 3. Worktree Isolation
```
git fetch origin && git checkout -b feature/XXX-issue-title
git worktree add .worktrees/fix-XXX-issue origin/main
```
- Prevents scope contamination from other branches
- Each issue = isolated worktree
- Clear ownership of changes

### 4. Explicit Process Steps
Don't assume CC knows the full workflow. List steps explicitly:
```
1. git fetch origin && git checkout -b fix/XXX-issue
2. Read the relevant files
3. Implement the fix
4. Quality gate: npx tsc --noEmit && npm run build && npm test
5. Commit with conventional commit message
6. git push -u origin fix/XXX-issue
7. Create PR via gh with Fixes #XXX
```

### 5. Teammates Mode for Parallelization
For independent tasks, spawn multiple CC sessions:
```
Session 1: issue #1111 — dashboard schema validation
Session 2: issue #1112 — CI permissions
Session 3: issue #1113 — ANSI escape
Session 4: issue #1114 — unsafe cast
```
Each in its own worktree. 4x faster.

### 6. Approval Gates in Skills
Brainstorming/writing-plans require approval before implementation:
- CC proposes approach
- Human/agent approves
- CC implements

This prevents wasted work on wrong approach.

### 7. Single Purpose Prompts
One issue per session. Don't combine:
❌ "Fix issues #1111, #1112, #1113 in one go"
✅ "Implement issue #1111: [specific description]"

### 8. Context Richness
Include:
- What the issue is (summary)
- Why it matters (security, UX, performance)
- Where the code is (file paths if known)
- Expected behavior
- Constraints

### 9. Quality Gate Always
```
npx tsc --noEmit
npm run build
npm test
```
Green = commit. Red = refine.

### 10. Conventional Commits
```
feat: add new feature
fix: bug fix
refactor: restructure without behavior change
perf: performance improvement
chore: build, CI, tooling
test: tests
docs: documentation
```
Only `feat:` bumps minor version.

---

## Anti-Patterns

### Don't
❌ Skip brainstorming for "simple" fixes — always design first
❌ Work on main branch — always use worktree
❌ Multiple issues in one session — scope creep
❌ Skip quality gate — technical debt accumulates
❌ Push without CI — break the build

### Do
✅ Use superpowers skill for structure
✅ Isolate each issue in its own worktree
✅ Single purpose session
✅ Quality gate before commit
✅ Wait for CI green before declaring done

---

## CC Behavior Patterns

### CC in Plan Mode
When CC asks clarifying questions in plan mode → ANSWER WITH CONTEXT. Don't say "just proceed".

### CC Tool Use
- CC uses tools extensively (Read, Bash, Grep, Glob)
- Let CC explore the codebase
- Trust the tool use

### CC Stall Detection
If CC hasn't responded in 5+ minutes:
1. Nudge: "Status? Where are you?"
2. If still stuck: assess if approach is wrong → refine or pivot

### Error Handling
If CC encounters an error:
1. CC usually self-corrects
2. If stuck: provide specific guidance
3. Don't micromanage — trust the process

---

## Template: Issue Implementation Prompt

```markdown
You are working in an isolated git worktree at /home/bubuntu/projects/aegis/.worktrees/fix-XXX-issue

FIRST: Invoke the [brainstorming OR writing-plans] skill to [analyze issue OR create implementation plan].

URL: https://github.com/OneStepAt4time/aegis/issues/XXX

[Issue title and description]

Process:
1. [Skill invocation]
2. [Get approval]
3. [Implement]
4. Quality gate: npx tsc --noEmit && npm run build && npm test
5. Commit with conventional commit message
6. git push -u origin fix/XXX-issue
7. Create PR via gh with Fixes #XXX
```

---

## When to Use Teammates Mode

**Good for:**
- Multiple independent issues
- Parallel PR reviews
- Research tasks
- Testing across platforms

**Not for:**
- Issues with dependencies (must be sequential)
- Complex issues needing deep context

---

_Updated: 2026-04-05 by Hephaestus_

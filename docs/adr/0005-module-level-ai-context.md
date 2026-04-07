# ADR-0005: Module-Level AI Context Files

Status: Accepted
Date: 2026-04-07
Issue: #1304

## Context

Aegis has grown to include a substantial server core (`src/`, ~60 files) and a React dashboard (`dashboard/src/`, ~30 files). The single root `CLAUDE.md` provides project-wide conventions but lacks module-specific guidance. When AI agents work within a specific module (e.g., the dashboard), they lack context about that module's architecture, key patterns, and conventions without reading many files first.

Existing AI context infrastructure:
- Root `CLAUDE.md` — project-wide commit/branching/quality rules
- `.claude/` — settings, hooks, skills (operational config, not architectural guidance)
- `CONTEXT.md` — architectural overview (high-level, not module-specific)
- No nested `CLAUDE.md` files exist in subdirectories

## Decision

Add `CLAUDE.md` files at the module level (`src/CLAUDE.md`, `dashboard/src/CLAUDE.md`) to provide targeted AI context. These files serve as the first thing an AI agent reads when entering a module.

### Principles for module-level context files

1. **Scope**: Each file covers only its module — no repetition of project-wide rules already in root `CLAUDE.md`.
2. **Brevity**: Under 100 lines. Link to source rather than duplicating.
3. **Audience**: Written for AI coding agents (Claude Code, Cursor, Copilot) and new contributors.
4. **Living docs**: Updated when module architecture changes significantly, not on every minor refactor.

### What goes in a module CLAUDE.md

- Module purpose and responsibilities
- Key files and their roles (not exhaustive file listings)
- Architecture patterns and conventions specific to the module
- Testing approach for the module
- Common pitfalls or anti-patterns to avoid
- Entry points and dependency flow

### What does NOT go in a module CLAUDE.md

- Project-wide conventions (already in root `CLAUDE.md`)
- Detailed API documentation (use TSDoc/JSDoc)
- Implementation details that change frequently
- Build/CI instructions (already in root `CLAUDE.md` and `package.json`)

## Consequences

Pros:
- AI agents get relevant context immediately without scanning dozens of files.
- New contributors can orient within a module faster.
- Module owners can document patterns specific to their domain.
- Complements existing ADR and CONTEXT.md infrastructure without duplication.

Cons:
- Another file to maintain — stale context is worse than no context.
- Risk of conflicting with root `CLAUDE.md` if conventions diverge.
- Requires discipline to keep module docs updated during refactors.

## Enforcement

- Module `CLAUDE.md` files are reviewed in PRs that touch module architecture.
- If a module's `CLAUDE.md` becomes stale (contradicts code), it should be updated or removed.
- New modules over ~10 files should consider adding their own `CLAUDE.md`.

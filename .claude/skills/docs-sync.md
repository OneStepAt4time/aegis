# Skill: docs-sync — TSDoc Coverage Check + README Auto-Update

Keep Aegis documentation in sync with the actual codebase. Audits TSDoc coverage on public exports, auto-fills missing JSDoc tags via ts-morph AST analysis, and syncs the README endpoint table with registered routes.

## When to Invoke

- After adding or modifying public functions, classes, or endpoints
- Before a release (docs freshness gate)
- When asked to "update docs", "check coverage", or "sync README"

## Prerequisites

```bash
npm ls ts-morph 2>/dev/null || npm install --save-dev ts-morph
```

## Workflow

### Step 1 — TSDoc Coverage Audit

Parse every `src/**/*.ts` file. For each **exported** function, method, and class:

1. Load the source with ts-morph (`Project` + `addSourceFilesAtPaths`)
2. Walk exported declarations: `SourceFile.getExportedDeclarations()`
3. For each function/method, check for JSDoc containing `@param`, `@returns`, `@throws`, `@example`
4. Score: a method is "documented" if it has a description **and** all params + returns tagged

Output a coverage table:

```
TSDoc Coverage Report
=====================
Documented: 42/68 methods (61.8%)

Missing @param:   src/session.ts:SessionManager.create (param: workDir, prompt)
Missing @returns: src/session.ts:SessionManager.kill
Missing @example: src/server.ts:healthHandler
...
```

### Step 2 — Auto-Fill Missing Tags (ts-morph)

For each gap found in Step 1, **propose** (don't auto-apply) insertions:

1. Read parameter types and names from the AST (`method.getParameters()`)
2. Infer return type from signature (`method.getReturnType().getText()`)
3. Generate `@param {type} name — description` lines
4. Generate `@returns {type} description` line
5. Generate a minimal `@example` stub

Apply insertions by updating the JSDoc comment on the node.

**Rules:**
- Never overwrite an existing tag — only add missing ones
- Keep existing description text untouched
- If a param already has `@param` but is missing another, only add the missing one
- Idempotent: running twice produces the same result

### Step 3 — README Endpoint Table Sync

1. Parse `src/server.ts` with ts-morph
2. Find all `app.get(...)`, `app.post(...)`, `app.put(...)`, `app.delete(...)`, `app.patch(...)` calls
3. Extract: HTTP method, route path, and the handler variable name or inline description
4. Compare against the tables in README.md under `## REST API`
5. Report:
   - **In code but not in README** (missing docs)
   - **In README but not in code** (stale docs)
6. Optionally update the README table (ask before applying)

### Step 4 — Coverage Report

Print a final summary:

```
=== docs-sync Summary ===
TSDoc:     42/68 methods documented (61.8%)
Endpoints: 24/28 in README, 4 missing
Stale:     2 endpoints in README not in code
Files touched: src/session.ts, src/server.ts, README.md
```

## Idempotency

- Auto-fill only inserts **missing** tags; never modifies existing ones
- README sync is additive — new routes are appended, stale ones are flagged but not removed automatically
- Running the skill twice with no code changes produces identical output

## Implementation Notes

- Use `ts-morph` for all AST work — no regex on source code
- For README parsing, simple string/regex is acceptable (markdown tables)
- Skip test files (`**/*.test.ts`, `**/*.spec.ts`), type-only files, and `index.ts` re-exports
- Skip private/internal methods (non-exported)

## CLI Script

```bash
# Dry-run report (default)
npx tsx scripts/docs-sync.ts

# Apply TSDoc tag insertions
npx tsx scripts/docs-sync.ts --fix

# Also update README endpoint table
npx tsx scripts/docs-sync.ts --fix --readme
```

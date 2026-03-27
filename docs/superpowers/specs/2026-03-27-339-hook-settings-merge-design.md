# Fix #339: Merge Hook Settings Into Project Settings

**Date:** 2026-03-27
**Issue:** #339
**Severity:** HIGH — sessions fail to start in bypassPermissions mode when hooks are configured

## Problem

When Aegis creates a CC session, `writeHookSettingsFile()` generates a temp file containing only HTTP hooks. This file is passed via `--settings`, which completely replaces the project's `.claude/settings.local.json`. CC loses env vars (API keys, proxy config), permission allowlists, `bypassPermissions`, MCP server configs, command-type hooks, and plugin settings.

## Root Cause

```
session.ts:writeHookSettingsFile() → /tmp/aegis-hooks/hooks-<id>.json
  ↓
tmux.ts: opts.settingsFile ?? settings.local.json
  ↓
--settings /tmp/aegis-hooks/hooks-<id>.json  (hooks-only file wins)
  ↓
CC never loads settings.local.json → no env, no permissions, no MCP
```

## Fix: Merge Into Temp File

Extend `writeHookSettingsFile()` to read the project's `settings.local.json` and produce a merged temp file that contains both project config and Aegis HTTP hooks.

### Merge Logic

1. Read `<workDir>/.claude/settings.local.json` (if it exists)
2. Parse as JSON → `projectSettings`
3. Generate Aegis HTTP hooks via existing `generateHookSettings()`
4. Merge: `{ ...projectSettings, hooks: mergeHooks(projectSettings.hooks, aegisHooks) }`
5. Write merged result to `/tmp/aegis-hooks/hooks-<id>.json` (same path pattern)

**Hook merge rule:** For each event name, concatenate project hooks first, then Aegis HTTP hooks. This preserves user's command hooks (e.g., PostToolUse type-checking) while adding Aegis event tracking.

### Files Changed

| File | Change |
|------|--------|
| `src/hook-settings.ts` | `writeHookSettingsFile()` gains `workDir` param, reads and merges project settings |
| `src/session.ts` | Pass `opts.workDir` to `writeHookSettingsFile()` |
| `src/__tests__/hook-settings.test.ts` | New tests for merge logic |

### What Stays the Same

- `tmux.ts` — unchanged, already uses whatever `settingsFile` path it receives
- `cleanupHookSettingsFile()` — unchanged, still removes the temp file
- Permission guard (`permission-guard.ts`) — unchanged, runs before merge, patches on-disk files

### Edge Cases

| Case | Behavior |
|------|----------|
| No `settings.local.json` exists | Falls back to hooks-only (current behavior) |
| Project has no `hooks` key | Aegis hooks become the only hooks |
| Project has hooks for same event | Both preserved: project's first, then Aegis |
| Invalid JSON in project settings | Log warning, fall back to hooks-only |
| `workDir` not provided | Falls back to hooks-only (backward compatible) |

### Execution Order

The merge reads `settings.local.json` **after** the permission guard has patched it. This ensures:
1. Permission guard neutralizes `bypassPermissions` if needed
2. Merge reads the (possibly patched) file
3. Merged temp file reflects the correct permission state

## Test Plan

- Unit tests for `mergeHooks()` with various combinations
- Unit test for full `writeHookSettingsFile()` with workDir
- Unit test for edge cases (missing file, invalid JSON, no hooks key)
- Existing session creation tests updated for new parameter

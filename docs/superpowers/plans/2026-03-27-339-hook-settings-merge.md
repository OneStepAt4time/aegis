# Fix #339: Hook Settings Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge project `settings.local.json` with Aegis HTTP hooks into a single temp file so CC doesn't lose env vars, permissions, MCP servers, or existing hooks.

**Architecture:** Extend `writeHookSettingsFile()` in `hook-settings.ts` to read the project's `.claude/settings.local.json`, deep-merge Aegis HTTP hooks into the `hooks` key (concatenating arrays per event name), and write the merged result to the same temp file path. Update `session.ts` to pass `workDir`. No changes to `tmux.ts`.

**Tech Stack:** TypeScript, Node.js fs/promises, Vitest

---

### Task 1: Add `mergeHooks()` and update `writeHookSettingsFile()` signature

**Files:**
- Modify: `src/hook-settings.ts`

- [ ] **Step 1: Write the failing test for `mergeHooks()`**

Add to `src/__tests__/hook-settings.test.ts` — a new `describe('mergeHooks')` block. But first, we need the export. Write the test that imports `mergeHooks` from `../hook-settings.js`:

```typescript
import { mergeHooks } from '../hook-settings.js';

describe('mergeHooks', () => {
  it('should merge Aegis hooks into empty project hooks', () => {
    const aegisHooks = { Stop: [{ hooks: [{ type: 'http' as const, url: 'http://localhost:9100/v1/hooks/Stop?sessionId=abc' }] }] };
    const result = mergeHooks({}, aegisHooks);
    expect(result).toEqual(aegisHooks);
  });

  it('should preserve project hooks and append Aegis hooks for the same event', () => {
    const projectHooks = {
      PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command' as const, command: 'npx tsc --noEmit' }] }],
    };
    const aegisHooks = {
      PostToolUse: [{ hooks: [{ type: 'http' as const, url: 'http://localhost:9100/v1/hooks/PostToolUse?sessionId=abc' }] }],
      Stop: [{ hooks: [{ type: 'http' as const, url: 'http://localhost:9100/v1/hooks/Stop?sessionId=abc' }] }],
    };
    const result = mergeHooks(projectHooks, aegisHooks);

    // PostToolUse should have project hook first, then Aegis hook
    expect(result.PostToolUse).toHaveLength(2);
    expect(result.PostToolUse![0]).toEqual({ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx tsc --noEmit' }] });
    expect(result.PostToolUse![1]).toEqual(aegisHooks.PostToolUse[0]);

    // Stop only has Aegis hook
    expect(result.Stop).toHaveLength(1);
    expect(result.Stop).toEqual(aegisHooks.Stop);
  });

  it('should return Aegis hooks when project hooks is undefined', () => {
    const aegisHooks = { Stop: [{ hooks: [{ type: 'http' as const, url: 'http://localhost:9100/v1/hooks/Stop?sessionId=abc' }] }] };
    const result = mergeHooks(undefined, aegisHooks);
    expect(result).toEqual(aegisHooks);
  });

  it('should return project hooks when Aegis hooks is empty', () => {
    const projectHooks = { Stop: [{ hooks: [{ type: 'command' as const, command: 'echo done' }] }] };
    const result = mergeHooks(projectHooks, {});
    expect(result).toEqual(projectHooks);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hook-settings.test.ts`
Expected: FAIL — `mergeHooks` is not exported from `../hook-settings.js`

- [ ] **Step 3: Implement `mergeHooks()` in `hook-settings.ts`**

Add the following export to `src/hook-settings.ts`, after the `HookSettings` interface (around line 67):

```typescript
/** CC settings.json hook entry — supports both command and http types. */
type HookEntry = {
  type: 'command' | 'http';
  command?: string;
  url?: string;
};

type HookGroup = { matcher?: string; hooks: HookEntry[] };

/**
 * Merge project hooks with Aegis HTTP hooks.
 * For each event name, project hooks come first, then Aegis hooks.
 */
export function mergeHooks(
  projectHooks: Record<string, HookGroup[]> | undefined,
  aegisHooks: Record<string, HookGroup[]>,
): Record<string, HookGroup[]> {
  const merged: Record<string, HookGroup[]> = {};

  // Start with project hooks
  if (projectHooks) {
    for (const [event, groups] of Object.entries(projectHooks)) {
      merged[event] = [...groups];
    }
  }

  // Append Aegis hooks per event
  for (const [event, groups] of Object.entries(aegisHooks)) {
    if (merged[event]) {
      merged[event] = [...merged[event]!, ...groups];
    } else {
      merged[event] = [...groups];
    }
  }

  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hook-settings.test.ts`
Expected: PASS — all `mergeHooks` tests pass

- [ ] **Step 5: Commit**

```bash
git add src/hook-settings.ts src/__tests__/hook-settings.test.ts
git commit -m "feat: add mergeHooks() for combining project and Aegis hook settings (#339)"
```

---

### Task 2: Update `writeHookSettingsFile()` to read and merge project settings

**Files:**
- Modify: `src/hook-settings.ts` (the `writeHookSettingsFile` function)
- Modify: `src/__tests__/hook-settings.test.ts` (add merge tests)

- [ ] **Step 1: Write the failing tests for merged file output**

Add to `src/__tests__/hook-settings.test.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

describe('writeHookSettingsFile with workDir merge', () => {
  const testWorkDir = join(tmpdir(), 'aegis-test-workdir-' + process.pid);
  const settingsDir = join(testWorkDir, '.claude');

  beforeEach(() => {
    mkdirSync(settingsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testWorkDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should merge project settings.local.json with Aegis hooks', async () => {
    // Write a project settings file with env and permissions
    const projectSettings = {
      env: { ANTHROPIC_AUTH_TOKEN: 'test-token', ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
      permissions: { allow: ['Bash(git:*)'], defaultMode: 'bypassPermissions' },
      hooks: {
        PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx tsc --noEmit' }] }],
      },
    };
    writeFileSync(join(settingsDir, 'settings.local.json'), JSON.stringify(projectSettings));

    const filePath = await writeHookSettingsFile('http://localhost:9100', 'merge-test', testWorkDir);

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // Project settings preserved
      expect(parsed.env).toEqual(projectSettings.env);
      expect(parsed.permissions).toEqual(projectSettings.permissions);

      // Project hooks preserved alongside Aegis hooks
      expect(parsed.hooks.PostToolUse).toHaveLength(2);
      expect(parsed.hooks.PostToolUse[0]).toEqual({ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'npx tsc --noEmit' }] });
      expect(parsed.hooks.PostToolUse[1].hooks[0].url).toContain('merge-test');

      // Aegis-only events also present
      expect(parsed.hooks.Stop).toBeDefined();
      expect(parsed.hooks.PreToolUse).toBeDefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should produce hooks-only file when no settings.local.json exists', async () => {
    // Don't write any settings file
    const filePath = await writeHookSettingsFile('http://localhost:9100', 'no-project', testWorkDir);

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);

      // Should only have hooks, no env/permissions
      expect(parsed.env).toBeUndefined();
      expect(parsed.permissions).toBeUndefined();
      expect(parsed.hooks).toBeDefined();
      expect(Object.keys(parsed.hooks)).toHaveLength(HTTP_HOOK_EVENTS.length);
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should produce hooks-only file when workDir is not provided', async () => {
    const filePath = await writeHookSettingsFile('http://localhost:9100', 'no-workdir');

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.env).toBeUndefined();
      expect(parsed.hooks).toBeDefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should fall back to hooks-only when project settings has invalid JSON', async () => {
    writeFileSync(join(settingsDir, 'settings.local.json'), '{ invalid json !!!');

    const filePath = await writeHookSettingsFile('http://localhost:9100', 'bad-json', testWorkDir);

    try {
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.hooks).toBeDefined();
      expect(parsed.env).toBeUndefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/hook-settings.test.ts`
Expected: FAIL — `writeHookSettingsFile` doesn't accept 3 arguments

- [ ] **Step 3: Update `writeHookSettingsFile()` to accept `workDir` and merge**

Replace the `writeHookSettingsFile` function in `src/hook-settings.ts` (lines 101-113) with:

```typescript
/**
 * Write hook settings to a temporary file, merging with project settings if available.
 *
 * @param baseUrl - Aegis base URL
 * @param sessionId - Aegis session ID
 * @param workDir - Optional project working directory (to read .claude/settings.local.json)
 * @returns Path to the temporary settings file
 */
export async function writeHookSettingsFile(baseUrl: string, sessionId: string, workDir?: string): Promise<string> {
  const aegisSettings = generateHookSettings(baseUrl, sessionId);
  const settingsDir = join(tmpdir(), 'aegis-hooks');

  if (!existsSync(settingsDir)) {
    await mkdir(settingsDir, { recursive: true });
  }

  // Issue #339: Merge with project settings.local.json if available.
  // This preserves env vars, permissions, MCP servers, and existing hooks.
  let mergedSettings: Record<string, unknown> = aegisSettings;

  if (workDir) {
    const projectSettingsPath = join(workDir, '.claude', 'settings.local.json');
    if (existsSync(projectSettingsPath)) {
      try {
        const { readFile } = await import('node:fs/promises');
        const content = await readFile(projectSettingsPath, 'utf-8');
        const projectSettings = JSON.parse(content) as Record<string, unknown>;
        mergedSettings = {
          ...projectSettings,
          hooks: mergeHooks(
            projectSettings.hooks as Record<string, Array<{ matcher?: string; hooks: Array<{ type: string }> }>> | undefined,
            aegisSettings.hooks,
          ),
        };
      } catch (e) {
        // Invalid JSON or read error — fall back to hooks-only
        console.warn(`Hook settings: failed to read/parse project settings at ${projectSettingsPath}: ${(e as Error).message}`);
      }
    }
  }

  const filePath = join(settingsDir, `hooks-${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(mergedSettings, null, 2) + '\n', 'utf-8');

  return filePath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/hook-settings.test.ts`
Expected: PASS — all tests pass, including new merge tests

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/hook-settings.ts src/__tests__/hook-settings.test.ts
git commit -m "feat: merge project settings with Aegis hooks in writeHookSettingsFile (#339)"
```

---

### Task 3: Update `session.ts` to pass `workDir` to `writeHookSettingsFile()`

**Files:**
- Modify: `src/session.ts` (line 336)

- [ ] **Step 1: Update the `writeHookSettingsFile` call in `session.ts`**

Change line 336 in `src/session.ts` from:

```typescript
      hookSettingsFile = await writeHookSettingsFile(baseUrl, id);
```

to:

```typescript
      hookSettingsFile = await writeHookSettingsFile(baseUrl, id, opts.workDir);
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/session.ts
git commit -m "fix: pass workDir to writeHookSettingsFile for settings merge (#339)"
```

---

### Task 4: Verify end-to-end

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Clean build with no errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification (#339)"
```

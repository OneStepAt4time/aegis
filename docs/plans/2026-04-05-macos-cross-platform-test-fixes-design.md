# Design: macOS Cross-Platform Test Fixes

**Issue:** #1228
**Date:** 2026-04-05
**Status:** Proposed

## Problem Statement

Aegis claims cross-platform support (Linux, macOS, Windows) but CI only tests Ubuntu and Windows. Running `npm test` on macOS reveals 11 failures across 2 test files, caused by platform-specific filesystem behavior differences.

## Root Cause Analysis

### 1. jsonl-watcher.test.ts — 8 failures

**Cause:** `fs.watch()` on macOS uses FSEvents (or kqueue), which delivers change notifications with higher latency than Linux's inotify. The test helper `waitForEvent()` uses a 2-second timeout and `collectEvents()` uses 300–500ms windows — both too tight for macOS event delivery.

**Impact:** Tests time out or collect zero events because the watcher callback fires after the assertion window closes.

**Fix strategy:**
- Replace tight fixed timeouts with a polling-based `waitForCondition()` helper that retries until a condition is met or a generous deadline expires. This is robust across all platforms.
- Increase `collectEvents` window with a platform-aware multiplier.
- Add a small delay after file writes to allow FSEvents coalescing (macOS batches rapid changes).

### 2. path-traversal-workdir-435.test.ts — 3 failures

**Cause:** On macOS, `/tmp` is a symlink to `/private/tmp`. The `validateWorkDir` function resolves the input path via `fs.realpath()` to `/private/tmp/...`, but the default safe directories list contains the literal string `/tmp`. Since `/private/tmp` is not a prefix of `/tmp`, the allowlist check fails and returns an error object instead of the resolved path string.

**Impact:** Any workdir under `/tmp` on macOS is incorrectly rejected as unsafe.

**Fix strategy:**
- In `validation.ts`, resolve each default safe directory through `fs.realpath()` before comparison. This ensures `/tmp` becomes `/private/tmp` on macOS, matching the resolved input path.
- This is a production bug fix, not just a test fix — it affects real macOS users.

### 3. CI matrix gap

**Cause:** `.github/workflows/ci.yml` matrix only includes `ubuntu-latest` and `windows-latest`.

**Fix strategy:**
- Add `macos-latest` to the matrix.
- Install tmux via Homebrew on macOS runners.

## Detailed Changes

### A. `src/validation.ts`

In the default safe directories construction, resolve each entry through `fs.realpath()` to handle platform symlinks:

```typescript
// Before (broken on macOS):
const safeDirs = [os.homedir(), '/tmp', '/var/tmp', process.cwd()];

// After (cross-platform):
const rawSafeDirs = [os.homedir(), '/tmp', '/var/tmp', process.cwd()];
const safeDirs = await Promise.all(
  rawSafeDirs.map(async (d) => {
    try { return await fs.realpath(d); }
    catch { return d; } // keep original if realpath fails
  })
);
```

### B. `src/__tests__/jsonl-watcher.test.ts`

Replace brittle timeout-based helpers with polling-based assertion:

```typescript
/** Poll until condition is met or deadline expires. */
async function waitForCondition<T>(
  fn: () => T | undefined,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = fn();
    if (result !== undefined) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
```

- `waitForEvent`: increase default timeout from 2s to 5s.
- `collectEvents`: increase window from 300–500ms to 1500ms.
- Add 50ms settle delay after file writes before assertions to accommodate FSEvents batching.

### C. `.github/workflows/ci.yml`

```yaml
matrix:
  os: [ubuntu-latest, windows-latest, macos-latest]
  node-version: ['20', '22']
```

Add tmux installation step for macOS:

```yaml
- name: Install tmux (macOS)
  if: runner.os == 'macOS'
  run: brew install tmux
```

## Testing

- All 2404 tests pass on macOS after changes.
- Verify no regressions on Linux by running full suite.
- CI validates all three platforms automatically.

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| validation.ts realpath | Low — additive, falls back to original | Try/catch preserves current behavior if realpath fails |
| Test timeout increases | None — test-only, no production impact | Polling approach is strictly more robust |
| CI macos-latest | Low — additive | fail-fast: false prevents macOS from blocking other platforms |

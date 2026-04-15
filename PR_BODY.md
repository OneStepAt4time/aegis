Fix: ensure the SessionMonitor passes a numeric initial offset to JsonlWatcher.watch to avoid a race where the watcher may start with `undefined` and skip existing JSONL entries.

Changes:
- src/monitor.ts: default the initial offset passed to `jsonlWatcher.watch` to `0` when `session.monitorOffset` is not a number.
- src/__tests__/monitor-initial-offset.test.ts: unit test asserting the monitor passes numeric offset (0) when `session.monitorOffset` is undefined.

Why:
- Race discovered during triage of #1767: monitor can call `watch` with `undefined` during discovery, causing the watcher to start with an invalid offset and potentially miss pre-existing entries.

Tests:
- Ran `npx tsc --noEmit` and `npx vitest` for the added test locally; the test passed.

Notes:
- Minimal, single-purpose change. Does NOT touch tmux/mock code; tmux flakiness remains tracked in issue #1810 and separate branch `fix/1810-bash-output`.

Please review: Argus + Manudis.

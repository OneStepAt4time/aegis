Fix: ensure the SessionMonitor passes a numeric initial offset to JsonlWatcher.watch to avoid a race where the watcher may start with `undefined` and skip existing JSONL entries.

Changes:
- src/monitor.ts: default the initial offset passed to `jsonlWatcher.watch` to `0` when `session.monitorOffset` is not a number.
- src/__tests__/monitor-initial-offset.test.ts: unit test asserting the monitor passes numeric offset (0) when `session.monitorOffset` is undefined.

Why:
- Triage of #1767 showed a race where monitor can call `watch` with undefined during discovery. This minimal fix prevents that race and is conservative.

Tests:
- Ran `npx tsc --noEmit` and the added unit test locally during triage.

Notes:
- This PR is intentionally minimal (only the two files). The previous PR #1833 has been closed because it was contaminated with unrelated changes; that branch remains for investigation. The tmux/mock work is tracked in issue #1810 and a separate branch.

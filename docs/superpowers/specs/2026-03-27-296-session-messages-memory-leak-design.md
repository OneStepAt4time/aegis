# Fix #296: sessionMessages unbounded memory leak

## Problem

The Zustand store contains `sessionMessages`, `setSessionMessages`, and `addMessage` — all dead code. Nothing writes to or reads from `sessionMessages`. The `TranscriptViewer` manages its own local state independently.

The actual message accumulation risk is in `TranscriptViewer`'s local `useState<ParsedEntry[]>`, which grows unboundedly for long-running session views.

## Design

### Remove dead store code

Delete from `dashboard/src/store/useStore.ts`:
- `sessionMessages: Record<string, ParsedEntry[]>` (interface + implementation)
- `setSessionMessages(sessionId, messages)` (interface + implementation)
- `addMessage(sessionId, entry)` (interface + implementation)

### Cap TranscriptViewer messages

In `dashboard/src/components/session/TranscriptViewer.tsx`:
- Add `const MAX_SESSION_MESSAGES = 1000`
- SSE handler: after appending, trim from front if over cap
- Initial load: take tail if API returns more than cap

## Files

- `dashboard/src/store/useStore.ts` — remove dead code
- `dashboard/src/components/session/TranscriptViewer.tsx` — add message cap
- `dashboard/src/__tests__/store.test.ts` — no changes needed (doesn't reference removed fields)

## Scope

Two files, ~10 lines net deletion. No API or backend changes.

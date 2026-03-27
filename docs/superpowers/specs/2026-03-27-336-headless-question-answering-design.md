# Issue #336: PreToolUse Hook updatedInput for Headless Question Answering

## Problem

When Claude Code invokes `AskUserQuestion` tool, Aegis's PreToolUse hook always returns `{ permissionDecision: "allow" }` immediately. The question goes to CC's terminal UI, blocking headless orchestration. External clients (dashboard, API consumers) have no way to answer questions programmatically.

## Solution

Add a `POST /v1/sessions/:id/answer` endpoint and update the PreToolUse hook to wait for external answers before responding to CC, using the same promise-based pattern as `waitForPermissionDecision`.

## Flow

1. CC invokes `AskUserQuestion` tool
2. Aegis PreToolUse hook fires with `tool_name: "AskUserQuestion"` and `tool_input` containing the questions
3. Aegis stores the pending question, emits `ask_question` SSE event with `questionId` (tool_use_id)
4. Hook blocks, waiting for external answer (configurable 30s timeout)
5. External client calls `POST /v1/sessions/:id/answer` with `{ questionId, answer }`
6. Aegis resolves the pending question
7. Hook returns `{ permissionDecision: "allow", updatedInput: { answer } }` to CC
8. CC receives the answer and continues

On timeout (no answer within 30s): hook returns `{ permissionDecision: "allow" }` without `updatedInput`, so CC shows the question to the user in the terminal as normal.

## Changes

### session.ts — Pending question tracking

New types and state:
- `PendingQuestion` interface: `{ resolve, timer, toolUseId, question }`
- `pendingQuestions: Map<string, PendingQuestion>` on SessionManager

New methods:
- `waitForAnswer(sessionId, toolUseId, question, timeoutMs)` → `Promise<string | null>` — creates pending entry, returns promise
- `submitAnswer(sessionId, questionId, answer)` → `boolean` — resolves pending promise, returns true if found
- `hasPendingQuestion(sessionId)` → `boolean`
- `cleanupPendingQuestion(sessionId)` → `void` — clears timer and entry (called from killSession)

### hooks.ts — AskUserQuestion detection

In the PreToolUse handler:
- Check if `tool_name === 'AskUserQuestion'`
- Extract question text from `tool_input` (first question's text)
- Emit `ask_question` SSE event with `{ questionId: tool_use_id, question }`
- Call `sessions.waitForAnswer()` with configurable timeout (default 30s)
- If answer received: return `{ permissionDecision: "allow", updatedInput: { answer } }`
- If timeout: fall through to existing allow-without-answer behavior

### server.ts — Answer endpoint

```
POST /v1/sessions/:id/answer
Body: { questionId: string, answer: string }
Response: 200 { ok: true } | 404 { error } | 409 { error: "No pending question" }
```

### Config

- `ANSWER_TIMEOUT_MS` env var (default 30_000)

## Edge Cases

- **Multiple questions in one AskUserQuestion call**: Only the first question's text is extracted for the event. The answer replaces the entire tool input.
- **Concurrent questions**: One pending question per session (matches CC behavior — questions are sequential).
- **Session killed while question pending**: `cleanupPendingQuestion()` called from `killSession()`.
- **Timeout**: Allow without answer — CC proceeds normally with original input.

## Testing

- Unit tests for `waitForAnswer` / `submitAnswer` on SessionManager
- Unit tests for the PreToolUse hook handler with AskUserQuestion tool_name
- Unit tests for the `/answer` endpoint
- Edge cases: timeout, session not found, no pending question, already answered

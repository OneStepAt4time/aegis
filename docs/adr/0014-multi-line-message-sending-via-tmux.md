# ADR-0014: Multi-line Message Sending via tmux Line-by-Line

Status: Accepted
Date: 2026-04-14
Issue: #1770, #1815

## Context

When sending multi-line messages to Claude Code sessions via `POST /v1/sessions/:id/send`, content was truncated at the first newline character. This broke prompts containing code blocks, markdown formatting, or any content with line breaks.

Root cause: the `send` endpoint passed message content directly to tmux without handling newline characters. tmux treats newlines as command terminators, so anything after the first newline was ignored.

## Decision

Send multi-line content **line-by-line via tmux** with proper escaping:

1. Split content on newlines
2. Send each line as a separate tmux command
3. Use a continuation marker for lines that are continuations (indented or joined)
4. Reassemble the complete message on the Claude Code side

### Implementation

The `sendMessage()` function in `src/tmux.ts` now:
- Detects multi-line content
- Sends the first line with the full command
- Sends subsequent lines as `send-keys` with proper tmux escaping
- Handles special characters (quotes, backslashes) via proper escaping

### API Behavior

- `POST /v1/sessions/:id/send` — accepts multi-line `content` field
- Content is preserved exactly — no normalization or truncation
- Works with tmux, psmux (Windows), and direct TCP modes

## Consequences

Pros:
- Fixes P1 bug affecting all multi-line prompts
- Enables code block delivery, markdown content, and formatted prompts
- Consistent behavior across all platforms (Linux, macOS, Windows)

Cons:
- Slight latency increase for very long messages (multiple tmux round-trips)
- Requires tmux compatibility on all platforms

## References

- Issue #1770 — original bug report
- PR #1815 — fix implementation

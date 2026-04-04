# ADR-0001: Windows Environment Injection Strategy

Status: Accepted
Date: 2026-04-04
Issue: #908

## Context

Aegis injects sensitive env vars into the running Claude pane. Existing Unix flow relies on shell semantics (`export`, `source`). On Windows/psmux, direct shell parity is unreliable.

## Decision

Adopt a hybrid strategy:
- Session-level propagation via `tmux set-environment`.
- Active pane propagation via temporary PowerShell file (`.ps1`) dot-sourcing and immediate cleanup.

## Consequences

Pros:
- Works for newly created panes and active panes.
- Avoids exposing secret values directly in terminal command history.
- Supports explicit escaping behavior in PowerShell.

Cons:
- Requires platform-specific branching and cleanup logic.
- ACL hardening must be best-effort on NTFS.

## Alternatives Considered

- A: set-environment only: insufficient for already-running pane process.
- B: PowerShell temp file only: does not persist session-level environment.
- C: inline send-keys with `$env:KEY=...`: simplest but leaks values in visible command stream.

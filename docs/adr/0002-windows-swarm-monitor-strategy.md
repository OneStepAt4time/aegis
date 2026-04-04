# ADR-0002: SwarmMonitor Strategy on Windows

Status: Accepted (MVP)
Date: 2026-04-04
Issue: #908

## Context

Current SwarmMonitor discovers tmux sockets using Unix-centric patterns. psmux uses a different control/socket model on Windows.

## Decision

Disable SwarmMonitor behavior on `win32` in MVP, with explicit informational logging and graceful no-op responses.

## Consequences

Pros:
- Prevents false errors and unstable discovery behavior.
- Keeps single-session and core orchestration reliable.

Cons:
- Multi-instance swarm discovery is unavailable on Windows in MVP.

## Future Work

Implement psmux-native discovery from `~/.psmux/*.key` and `.port` metadata, or move to explicit HTTP registration.

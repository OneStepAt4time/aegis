# ADR-0004: psmux Version Pinning

Status: Accepted
Date: 2026-04-04
Issue: #908

## Decision

Require psmux/tmux compatibility at version 3.3+ for Windows support.

## Rationale

- Empirical checks in Sprint 0 performed on tmux 3.3 (psmux) succeeded.
- Known behavior differences and bugs are documented and manageable at this level.

## Enforcement

- CI installs psmux on Windows runners.
- Startup diagnostics should surface tmux version when capabilities are missing.

## Consequences

- Users on older psmux versions may experience undefined behavior and should upgrade.

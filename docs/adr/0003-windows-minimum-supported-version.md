# ADR-0003: Minimum Supported Windows Version

Status: Accepted
Date: 2026-04-04
Issue: #908

## Decision

Set minimum supported version to Windows 10 (1903+) with Windows 11 recommended.

## Rationale

- ConPTY and terminal behavior are materially more stable on these versions.
- Tooling support (Node, PowerShell, psmux compatibility) is adequate.

## Consequences

- Older Windows versions are out of support for Aegis Windows mode.
- Documentation must clearly state this requirement.

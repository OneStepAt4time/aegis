# ADR-0030: Network Isolation Scope by Deployment Tier

**Status:** Accepted
**Date:** 2026-05-22
**Context:** #3998, #3980

## Decision

ACP child processes run with unrestricted host network access during the solo-dev phase. Network isolation (namespaces, egress proxy, or container-level filtering) will be mandatory for multi-user and hosted deployments, scheduled for Phase 4.

## Context

Aegis uses ACP (Agent Control Protocol) to manage Claude Code sessions. These sessions are child processes on the host machine. For solo-dev localhost use, the agent runs as the same user who owns the machine — network access is equivalent to the user's own access.

For multi-user deployments (team, enterprise), different users' agents must not be able to exfiltrate data from each other or from the host. Network isolation becomes a hard requirement at this scale.

## Options Considered

### Option A: Always isolate (namespaces from day one)
- **Pros:** Defense-in-depth, consistent across tiers
- **Cons:** Complex setup for solo devs, breaks localhost workflows (agents can't reach local services), adds operational friction to the zero-config experience

### Option B: Isolate only for multi-user deployments (accepted)
- **Pros:** Zero-config solo-dev experience preserved, isolation added only when the threat model changes
- **Cons:** Solo-dev agents have full network access — acceptable because the user IS the agent owner

### Option C: Egress proxy with allowlists
- **Pros:** Fine-grained control over outbound destinations
- **Cons:** Requires running a proxy service, configuration burden for solo devs, breaks many agent workflows that need arbitrary API access

## Consequences

- Solo-dev users: no action needed. Agents have the same network access as the user.
- Multi-user deployments (Phase 4): must deploy with network namespaces, egress proxy, or container-level isolation before going live.
- Documentation must clearly disclose this limitation so operators can make informed deployment decisions.
- Security best practices guide updated with the limitation and recommended mitigations.

## References

- #3980 — Per-adapter sandboxing requirement
- #3998 — Documentation task for this limitation
- [Security Best Practices](../security-best-practices.md#known-security-limitations) — user-facing disclosure

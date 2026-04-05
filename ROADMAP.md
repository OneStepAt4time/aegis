# Aegis Roadmap

> **Aegis is currently in Alpha.** APIs and features may change. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to help.

---

## Vision

Aegis aims to be the reference orchestration bridge for Claude Code — production-ready, documented, tested, and secure.

---

## Milestone 1: Foundation

**Goal:** Zero regressions, CI always green, coverage ≥ 65%

- [ ] Integration tests: session lifecycle (create → poll → kill)
- [ ] Integration tests: dashboard SSE events
- [ ] Fix dashboard-test flakiness → deterministic
- [ ] Coverage gate: 65% minimum enforced in CI

## Milestone 2: Security Hardening

**Goal:** Security documented and tested

- [ ] Permission modes documented for end users
- [ ] Rate limiting documented
- [ ] Audit log system
- [ ] Security integration tests

## Milestone 3: Enterprise Ready

**Goal:** Production-grade stability

- [ ] Structured health check endpoint
- [ ] Error recovery tested
- [ ] Graceful degradation
- [ ] Integration tests: auth + rate limiting

## Milestone 4: Documentation & Growth

**Goal:** 5-minute onboarding, community-ready

- [ ] Getting Started guide (zero to running in 5 minutes)
- [ ] Onboarding documentation
- [ ] Case study template
- [ ] Contributing guide complete

---

## Principles

1. **Quality over velocity** — every PR must make the product better, not just different
2. **Coverage gate enforced** — no merge if coverage drops
3. **Zero regressions** — integration tests as gates
4. **Documentation required** — no release without updated docs

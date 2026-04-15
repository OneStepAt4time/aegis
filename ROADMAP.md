# Aegis Roadmap

> **Aegis is in Alpha only.** Legacy release tracks are retired; planning is focused on alpha hardening and graduation readiness.

---

## North Star

Become the most reliable orchestration bridge for Claude Code across Linux, macOS, and Windows, with security-first defaults and deterministic CI gates.

---

## Alpha Priorities (Current)

### A1: Reliability Gates

**Goal:** No broken code reaches `develop`.

- [ ] Mandatory local gate in contributor workflow (`npm run gate`)
- [ ] Pre-push hook adoption in active worktrees
- [ ] CI pass-rate baseline tracked weekly
- [ ] Flaky test budget defined and enforced

### A2: Security Hardening

**Goal:** Strong pre-merge and pre-release safeguards.

- [ ] Branch protection parity on `main` and `develop`
- [ ] Required checks include lint, test matrix, dashboard tests, CodeQL
- [ ] Secret scanning and push-protection monitoring loop
- [ ] Security documentation aligned with alpha lifecycle

### A3: Release Integrity

**Goal:** Reproducible, verifiable alpha releases.

- [ ] Keep npm provenance enabled for all releases
- [ ] Maintain SBOM + checksum publication on every tag
- [ ] Validate release-please flow on each promotion cycle

### A4: Developer and Agent Workflow

**Goal:** AI-assisted development that is safe by default.

- [ ] Agent policies aligned (no push/PR with red gate)
- [ ] Escalation pattern standardized (`needs-human`)
- [ ] Worktree-first workflow enforced in docs and practice

---

## Graduation Signals (Alpha -> Next Phase)

- [ ] Stable CI on protected branches across required jobs
- [ ] No unresolved high-priority security gaps
- [ ] Documented incident/rollback playbook validated
- [ ] Core docs remain current and free of placeholder content

---

## Principles

1. **Quality over velocity**: every merged PR must improve reliability or clarity.
2. **Security before convenience**: defaults must prevent risky behavior.
3. **Deterministic gates**: local + CI checks are non-optional.
4. **Docs as contract**: behavior and policy must match documentation.

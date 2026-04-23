# Phase 2 Exit Checklist

> **Goal:** Confirm Aegis is ready for the first external team deployment.
> This checklist validates every Phase 2 deliverable from [ROADMAP.md](./ROADMAP.md).

---

## Legend

| Mark | Meaning |
|------|---------|
| `[x]` | Verified / shipped |
| `[ ]` | Not yet verified |
| `N/A` | Deferred with documented rationale |

---

## 1. Developer Experience

| # | Deliverable | Status | Verification |
|---|-------------|--------|--------------|
| 1.1 | `ag` alias + interactive `ag init` | [ ] | `ag init` runs interactively; `ag --help` shows `ag` as primary command |
| 1.2 | `ag doctor` diagnostics command | [ ] | `ag doctor` passes on a clean install; `ag doctor --json` returns valid JSON |
| 1.3 | BYO LLM official support + `examples/byo-llm/` + CI mock | [ ] | `examples/byo-llm/` exists; CI mock smoke passes; [docs/byo-llm.md](docs/byo-llm.md) covers providers |
| 1.4 | Agent / skill / slash-command template gallery (`ag init --from-template`) | [ ] | `ag init --list-templates` lists templates; `ag init --from-template code-reviewer` scaffolds correctly |
| 1.5 | Remote-access guide (Tailscale, Cloudflare Tunnel, ngrok) | [ ] | [docs/remote-access.md](docs/remote-access.md) covers all three; verified on at least one tunnel |

## 2. Dashboard

| # | Deliverable | Status | Verification |
|---|-------------|--------|--------------|
| 2.1 | Mobile-first dashboard pass | [ ] | Dashboard renders and is usable on mobile viewport (375px width) |
| 2.2 | Dashboard home / onboarding flow | [ ] | First visit shows onboarding; dashboard home shows session overview |
| 2.3 | CSP + token out of localStorage | [ ] | CSP header present in responses; dashboard token in memory only (not localStorage); see [ADR-0024](docs/adr/0024-dashboard-token-in-memory.md) |

## 3. Team-Ready Features

| # | Deliverable | Status | Verification |
|---|-------------|--------|--------------|
| 3.1 | Per-action RBAC: `send`, `approve`, `reject`, `kill`, `create` (P0-6) | [ ] | Operator key can `create` + `send` own sessions but not `kill` others'; viewer key is read-only |
| 3.2 | Audit export API + base UI (P1-8) | [ ] | `GET /v1/audit?format=json` returns structured records; dashboard audit page renders with filters |
| 3.3 | Helm chart v1 (P1-9) | [ ] | `helm install aegis aegis/aegis` succeeds on a clean k3s cluster; liveness/readiness probes pass |

## 4. Reliability & Security

| # | Deliverable | Status | Verification |
|---|-------------|--------|--------------|
| 4.1 | Fault-injection harness in release gate (P1-6) | [ ] | Harness runs on tag in CI; at least one fault scenario asserts graceful degradation |
| 4.2 | Prompt-injection hardening for MCP prompts (P2-3) | [ ] | MCP prompts (`implement_issue`, `review_pr`, `debug_session`) sanitize untrusted input |
| 4.3 | Windows/macOS smoke on `develop` (P1-5) | [ ] | CI matrix includes Windows + macOS on `develop`; core tests pass |

## 5. Documentation Alignment

| # | Deliverable | Status | Verification |
|---|-------------|--------|--------------|
| 5.1 | [EXTERNAL_DEPLOYMENT_GUIDE.md](EXTERNAL_DEPLOYMENT_GUIDE.md) — step-by-step for external teams | [ ] | Guide covers prerequisites through first-run verification; reviewed by a non-contributor |
| 5.2 | Policy docs synchronized: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `SECURITY.md` | [ ] | `git grep` finds no stale alpha/lifecycle inconsistencies |
| 5.3 | API reference matches running server | [ ] | `diff <(curl /v1/openapi.json | jq) <(cat docs/openapi.yaml)` shows no drift |

## 6. Graduation Signals (Preview -> GA)

From [ROADMAP.md](./ROADMAP.md) "Graduation Signals":

| # | Signal | Status | Notes |
|---|--------|--------|-------|
| 6.1 | All Phase 2 items shipped | [ ] | Every unchecked item in ROADMAP Phase 2 resolved or deferred with issue |
| 6.2 | "alpha" dist-tag / version suffix renamed to "preview" | [ ] | `npm view @onestepat4time/aegis dist-tags` shows `preview`; no `alpha` references in package metadata |
| 6.3 | Public demo video of mobile approval flow | [ ] | Video linked in README or docs |
| 6.4 | Incident / rollback runbook validated at least once | [ ] | [docs/incident-rollback-runbook.md](docs/incident-rollback-runbook.md) exists; at least one dry-run performed |
| 6.5 | Confirm first external team deployment | [ ] | External team completed [EXTERNAL_DEPLOYMENT_GUIDE.md](EXTERNAL_DEPLOYMENT_GUIDE.md) end-to-end; deployment verified |

## 7. Pre-Release Hygiene

```bash
# All must pass before Phase 2 is declared complete
npm run gate                    # tsc + build + test + hygiene
git status --short              # no untracked artifacts
git ls-files --others --exclude-standard  # no surprises
git grep -n "UAT_BUG_REPORT\|UAT_CHECKLIST\|UAT_PLAN\|DEPLOYMENT.md\|coverage-gap-analysis"  # no obsolete refs
```

| # | Check | Status |
|---|-------|--------|
| 7.1 | `npm run gate` passes | [ ] |
| 7.2 | No untracked / trash artifacts | [ ] |
| 7.3 | No obsolete legacy file references | [ ] |
| 7.4 | All ADRs from Phase 2 in `accepted` state | [ ] |

---

## Sign-Off

| Role | Name | Date |
|------|------|------|
| Maintainer | | |
| External team lead | | |
| Security reviewer | | |

Once all items are checked, Phase 2 is complete and [ROADMAP.md](./ROADMAP.md) should be updated to mark Phase 2 as `COMPLETE`.

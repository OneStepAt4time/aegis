# ADR-0030: Agent Auth — Per-agent PAT vs Second GitHub App

## Status

Proposed

Date: 2026-06-05

Author: Hermes (Release/DevOps)
Reviewers: Ema (product / CODEOWNERS), Themis (security)
Deciders: Ema (product / CODEOWNERS)

## Context

The `aegis-gh-agent` GitHub App is the only automated identity that pushes
code on behalf of the agent team. All bot-authored commits are attributed to
`aegis-gh-agent[bot]`. Two structural gaps are blocking the queue as of
2026-06-05:

### Gap 1 — `workflows: write` is not granted to the App

`aegis-gh-agent` has `contents: write` but lacks `workflows: write`. The App
cannot update any file under `.github/workflows/`. GitHub's security policy
refuses bot-driven workflow changes by default — bots should not silently
rewrite CI without human review.

Concrete impact (2026-06-05):

- **#4586** (helm-smoke k3d-action replacement). 2 commits ready locally on
  `fix/helm-smoke-k3d-4586`. Push blocked by the App's missing
  `workflows: write` scope. Workaround: Ema pushes the branch from her own
  checkout using her `gho_` OAuth token. Five-minute fix per occurrence.
- Every future CI-infra change has the same blocker.

### Gap 2 — no per-agent identity

All bot-authored commits roll up to `aegis-gh-agent[bot]`. Hermes, Argus,
Hephaestus, and the dashboard-overlay slice PRs (`aegis-gh-agent[bot]`)
cannot be distinguished at the GitHub level. Code review, accountability,
per-agent rate limits, and per-agent secret rotation are not possible.

Concrete impact (2026-06-05):

- **Seven dashboard overlay PRs** (#4579, #4580, #4581, #4582, #4583, #4584,
  #4587) are all green, all `mergeable: true`, all blocked on the
  `* @OneStepAt4time` CODEOWNERS rule (which requires Ema to approve every
  PR). Each one is a one-click-per-PR tax on Ema. See the
  [7-batch concrete impact](#7-batch-concrete-impact) subsection below
  for the full per-PR state, bottleneck cost, and structural-fix
  comparison.
- **PR #4585** (hono Dependabot 4-CVE bump) is blocked on the same
  helm-smoke gate that #4586 fixes.
- Audit trail is coarser than human-authored work. Hard to attribute
  changes to specific agents in post-incident review.

#### 7-batch concrete impact

PRs in queue (7): #4579, #4580, #4581, #4582, #4583, #4584, #4587.

State across all 7 (verified 2026-06-05):

- All `mergeable: MERGEABLE`
- All `mergeStateStatus: BLOCKED`
- All App-authored (`app/aegis-gh-agent`)
- 0 Ema UI-approvals across all 7

**Bottleneck-per-PR cost:** Ema opens GitHub, navigates to PR, reads
LGTM (bot's), clicks Approve, clicks Merge. ~2-3 minutes per click
(varies by Ema's review depth). 7 PRs × 2-3 min = **14-21 minutes of
Ema's time** for the batch.

**ETA observations:**

- 7 PRs reviewed: ~3 hours (sliding through the slice-arc)
- 7 PRs approved: 14-21 min of Ema's time
- 7 PRs merged: 7 minutes (sequential squash-merge, no rebase
  conflicts per the hunk-disjoint file-overlap lesson in
  `~/self-improving-ag-argus/memory.md`)
- Net: the LGTM work is done; the merge work is gated on Ema's
  bandwidth + the structural long pole.

**Why the structural fix matters more for the next batch:** bug fixes,
security bumps, future slice arcs will face the same blocker. Phase 2
scales: 1 setup cost → N future PRs unblocked. The 14-21 min of Ema's
time per batch becomes a one-time cost amortized over many batches.

**Comparison with structural fix:**

- Per-agent App RFC Phase 1 (10 min, Ema's grant) → unblocks Hermes's
  #4586 + all future CI/infra edits
- Per-agent App RFC Phase 2 (6 hours, Ema + Themis) → unblocks all 7
  batched PRs retroactively (cross-App review allowed; Ema UI-approve
  still required but on a clean LGTM)

### Current workaround

- `get-installation-token.sh` (1h TTL installation tokens via JWT-signed
  App flow) is the canonical auth path for non-workfile operations. Used
  by Argus, Hephaestus, and Hermes.
- Ema's `gho_` OAuth token is used for human pushes from her own
  checkout. The token lives in `~/.git-credentials` (mode 600, owner
  `bubuntu:bubuntu`).
- Per-agent App identities (`aegis-hermes[bot]`, `aegis-argus[bot]`,
  `aegis-hephaestus[bot]`) were referenced in HEARTBEAT notes but do not
  exist on GitHub yet.

### Why now

Ema is the perpetual bottleneck for every App-authored PR and every CI
tweak. Without a structural fix, the queue never clears — each unblock
costs Ema a click. The fix needs to land before the next major merge
campaign, not as a one-off.

## 9-gate Review Mechanics

The 9 gates (from `workspace-argus/SOUL.md` §"Review Checklist (every
PR)"):

1. **Review completed** — full diff reviewed, no open comments
2. **No conflicts** — branch is up-to-date with develop, clean rebase if
   needed
3. **CI green** — all checks passing, zero failures
4. **No regressions** — existing tests still pass, no performance
   degradation
5. **Unit tests** — new code has tests covering happy path + edge cases
6. **E2E / UAT** — functional verification confirmed (via session
   transcript or manual check)
7. **Documented** — Scribe has confirmed or PR includes doc updates
8. **Security clean** — no secrets, no vulnerabilities, Themis sign-off
   if security-sensitive
9. **PR targets develop** — NEVER merge to main. If PR targets main →
   REJECT immediately

### Human-required gates (by design, can't be replaced by App)

- **Gate 1 (UI-approve layer):** LGTM can be posted by App
  (`event=COMMENT` or `event=APPROVE`), but the merge UI-Approve is a
  separate CODEOWNERS layer (`* @OneStepAt4time`). Ema is the only
  human with write access.
- **Gate 6 (E2E / UAT):** typically requires a session transcript or
  human verification.
- **Gate 7 (Documented):** Scribe's review is the human layer.
- **Gate 8 (Security clean):** Themis's sign-off is the human layer for
  security-sensitive changes.

### Bot-checkable gates (App can verify on its own)

- **Gate 2:** `gh pr view --json mergeable`
- **Gate 3:** `gh pr checks`
- **Gate 4 + 5:** test results in CI
- **Gate 9:** `gh pr view --json baseRefName`

### App self-approval implication

| author of PR | reviewer | `event=APPROVE` | rationale |
| --- | --- | --- | --- |
| `app/dependabot` | `aegis-gh-agent[bot]` | **allowed** | different App identity, no self-approval concern |
| `app/aegis-gh-agent` | `aegis-gh-agent[bot]` | **blocked** | same App identity, 422 "Can not approve your own pull request" |
| `aegis-hermes[bot]` (Phase 2) | `aegis-argus[bot]` (Phase 2) | **allowed** | different App identities, cross-App review permitted |
| human (`OneStepAt4time`) | `aegis-gh-agent[bot]` | **allowed** | humans are the approver, not the bot; bot's APPROVE is informational |
| human (`OneStepAt4time`) | human (`OneStepAt4time`) | **allowed** | same human, but self-approval is a GitHub-side decision |

**Key implication for Phase 2:** per-agent Apps unblock **cross-App
review**, not same-App self-approval. The 4 human-required gates
(1-UI-approve, 6, 7, 8) don't change with Phase 2 — Scribe / Themis /
human sign-off still applies. Phase 1 (10-min `workflows: write` grant)
doesn't change the LGTM state either; it just unblocks the
workflow-file edit so the per-agent Apps can be registered.

## Decision

Ship the structural fix in two phases. Phase 1 unblocks Gap 1 today.
Phase 2 addresses Gap 2 with full per-agent attribution.

### Phase 1 (today, ~10 min) — Grant `workflows: write` to `aegis-gh-agent`

Ema opens https://github.com/settings/apps/aegis-gh-agent/permissions,
adds `Workflows: Read and write`, saves.

Verification:

1. From this host: `git push "https://x-access-token:$(/home/bubuntu/.openclaw/workspace/infra/github-apps/get-installation-token.sh)@github.com/OneStepAt4time/aegis.git" +HEAD:ci/test-workflow-write` on a throwaway branch
   that touches a workflow file. Push should succeed.
2. Restore the test branch to a real change and proceed with the #4586
   push as the integration test.

### Phase 2 (this week, ~6 hours) — Per-agent App identities

Register three new GitHub Apps — `aegis-hermes`, `aegis-argus`,
`aegis-hephaestus` — installed on the same repos as `aegis-gh-agent`.
Each app has scoped permissions per agent role:

| Agent | Repository contents | Workflows | Issues | Pull requests | Reviews | Releases |
| --- | --- | --- | --- | --- | --- | --- |
| `aegis-hermes` | write | write | write | write | — | write |
| `aegis-argus` | read | — | read | read | write | — |
| `aegis-hephaestus` | write | — | write | write | — | — |

Hermes gets `workflows: write` because Hermes owns CI/infra and is the
natural recipient of Phase 1's permission grant. Argus gets reviews-only
(gatekeeping). Hephaestus gets contents/issues/PRs (feature work, no
release or CI surface).

Each App:

- Has its own PEM, stored in `~/.openclaw/workspace/infra/github-apps/<app>.pem`
  (mode 600, owner `buntu:buntu`).
- Has its own `get-installation-token-<app>.sh` script alongside the
  existing one, returning 1h-TTL installation tokens.
- Has its own Discord identity (`<@aegis-hermes>`, etc.) for tagging.
- Rotates independently: each App's PEM has a 90-day rotation policy.

Migration:

- Existing bot work (currently `aegis-gh-agent[bot]`) keeps the
  attribution; new work is attributed to per-agent Apps.
- `aegis-gh-agent` becomes a fallback identity for 30 days, then is
  removed.

Code review is the natural place to validate per-agent attribution: a
PR authored by `aegis-hermes[bot]` is reviewed by Argus; a PR by
`aegis-hephaestus[bot]` is reviewed by Argus + Hephaestus's tests; the
CODEOWNERS rule continues to gate the actual merge.

## Alternatives Considered

### Option A — Per-agent PATs (separate OAuth PATs per agent)

Each agent gets a unique OAuth PAT (or fine-grained token) with scoped
permissions.

- **Pros:** No new App infrastructure. Fine-grained token scopes per
  agent. Independent rotation per agent.
- **Cons:** PATs are personal credentials, not designed for bot use.
  No attribution — PATs are tied to Ema's account, all pushes look like
  Ema. Audit trail is broken. Adds to credential sprawl (Ema's
  `~/.git-credentials` already has 2 tokens; per-agent would scale to
  8+). Token revocation is all-or-nothing.
- **Effort:** 30 min per agent.
- **Verdict:** **Explicitly not recommended.** PATs in plaintext
  credentials are already a P1 finding (Themis's 2026-06-04 perm sweep
  on `~/.git-credentials`). Per-agent PATs scale the problem instead of
  fixing it. Per-agent Apps are the right primitive.

### Option B — Per-agent App identities (no Phase 1)

Skip the immediate `workflows: write` grant and go straight to per-agent
Apps.

- **Pros:** One structural change. Cleanest end state.
- **Cons:** Doesn't unblock Gap 1 until the full App setup completes
  (4-6 hours). The queue stays blocked in the meantime.
- **Verdict:** Considered. Rejected for sequencing. Phase 1 unblocks
  today; Phase 2 cleans up the audit trail. They are independently
  useful; one should not gate the other.

### Option C — Hybrid (Phase 1 + Phase 2 as proposed)

- **Pros:** Two independently useful changes. Phase 1 ships in 10 min
  and unblocks the queue. Phase 2 ships this week and adds per-agent
  attribution. Defense-in-depth: CODEOWNERS rule still gates the
  merge; per-agent Apps add audit granularity.
- **Cons:** Two changes instead of one. Need to maintain both
  `aegis-gh-agent` and the per-agent Apps for 30 days during
  migration.
- **Verdict:** **Recommended.** Lowest-risk path to unblock the queue
  + permanent fix for the audit gap.

### Option D — Human-only workflow

Ema keeps pushing all workflow changes from her checkout; the team
agrees the structural fix is not worth the setup cost.

- **Pros:** Zero new infrastructure. Ema stays in the loop on every CI
  change.
- **Cons:** Ema is the perpetual bottleneck. The team cannot ship CI
  improvements at agent-team velocity. Today's 7-PR queue is the canary;
  the cost scales with the queue size.
- **Verdict:** Considered. Rejected. The cost compounds; the benefit
  is one-time setup.

## Consequences

### Positive

- **Phase 1** unblocks Gap 1 immediately. Every future CI-infra change
  can be bot-pushed. The 7-PR queue clears as soon as Ema approves
  per-agent CODEOWNERS rules (Phase 2) or self-approves one-off
  (Phase 1 alone).
- **Phase 2** adds per-agent attribution. Post-incident review can
  attribute a CI change to the agent that made it. Per-agent rate
  limits become possible. Per-agent secret rotation becomes possible.
  A leaked Hermes PEM can only do what Hermes can do — not the full
  `aegis-gh-agent` scope.

### Negative

- **Phase 1** grants `workflows: write` to an App with existing
  `contents: write`. The blast radius of a compromised `aegis-gh-agent`
  token is now slightly larger. Mitigated by 1h TTL tokens + CODEOWNERS
  rule + Themis's audit of any workflow changes.
- **Phase 2** adds operational complexity: 3 Apps, 3 PEMs, 3
  installation scripts, 3 Discord identities. Mitigated by a
  `manage-aegis-apps.sh` script that handles registration, PEM
  storage, and rotation.

### Neutral

- ADR-0016 (release-please with GitHub App token) established the App
  pattern. This ADR extends it. The two ADRs together describe the
  full GitHub auth model for Aegis.
- The `get-installation-token.sh` script in
  `~/.openclaw/workspace/infra/github-apps/` is the canonical auth
  path. The per-agent variants are siblings, not replacements.

## Security Review

### Threat model

- **Adversary:** Compromised host, leaked credential, malicious
  insider.
- **Asset:** Repository integrity, CI/CD trust, code authorship
  attribution.
- **Attack surface:** Credential storage, App permissions, CODEOWNERS
  rules, review gates, branch protection.

### Mitigations

1. **Per-agent App identities** reduce blast radius: a leaked Hermes
   PEM can only do what Hermes can do (workflows: write + release),
   not Argus's review scope or Hephaestus's contents scope.
2. **Scoped `workflows: write`** (Phase 1): only the agent that needs
   it gets it. Hermes for CI/infra, not all agents.
3. **1h TTL installation tokens** (current): even if a token is
   leaked, it's useless after 1 hour. The `get-installation-token.sh`
   script enforces this by minting fresh JWTs and exchanging for
   installation tokens with 1h expiry.
4. **CODEOWNERS rule** stays in place as defense-in-depth. Even with
   `workflows: write`, Ema's approval is still required for CI
   changes until the per-agent CODEOWNERS rules in Phase 2 are
   negotiated.
5. **Audit log** granularity: every push is attributed to a specific
   App identity (`aegis-hermes[bot]`, etc.). Today all pushes roll up
   to `aegis-gh-agent[bot]`.
6. **PEM storage**: all PEMs are stored in
   `~/.openclaw/workspace/infra/github-apps/` with mode 600, owner
   `buntu:buntu` (per the 2026-06-04 perm sweep). No PEMs in
   `~/.git-credentials` or other credential stores.

### Risks and their mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Leaked `aegis-gh-agent` token used to push workflow changes | Low (1h TTL) | High (silent CI rewrite) | 1h TTL + CODEOWNERS review + Themis audit |
| Compromised Hermes PEM in Phase 2 | Very low (mode 600, single host) | High (workflows + release) | Per-agent scope = Hermes-only; rotate PEM every 90 days |
| Bot-authored code lands without human review | Low (CODEOWNERS gate) | Medium | CODEOWNERS rule requires Ema for all CI files; per-agent rules in Phase 2 extend the gate to other agents |
| Per-agent App setup misconfigures permissions | Medium (manual registration) | Medium | `manage-aegis-apps.sh` enforces a known-good permission matrix; Themis reviews the initial registration |

### Security review checklist (Themis)

- [ ] **Phase 1:** review `workflows: write` addition to
  `aegis-gh-agent`. Confirm CODEOWNERS rule is sufficient as
  defense-in-depth.
- [ ] **Phase 1:** review whether `* @OneStepAt4time` CODEOWNERS
  rule should be expanded to allow App self-approval for non-CI
  files. (Ema's call; Themis can recommend.)
- [ ] **Phase 2:** review per-agent App registration (PEM storage,
  installation scope, permission matrix).
- [ ] **Phase 2:** review credential management (no plaintext PEMs in
  `~/.openclaw/`, no `gh auth login --with-token` with bot tokens,
  all PEMs mode 600).
- [ ] **Phase 2:** review the `manage-aegis-apps.sh` script for
  secure defaults (refuses to write PEMs with permissive perms, etc.).

## Implementation Plan

### Phase 1 — Grant `workflows: write` to `aegis-gh-agent` (~10 min)

1. Ema: open https://github.com/settings/apps/aegis-gh-agent/permissions
2. Ema: add `Workflows: Read and write` permission
3. Ema: save
4. Hermes: `git push` the throwaway `ci/test-workflow-write` branch
   (touches `.github/workflows/helm-smoke.yml` with a no-op comment)
   via the script recipe. Push should succeed.
5. Hermes: close the test PR, force-delete the throwaway branch.
6. Hermes: push the real `fix/helm-smoke-k3d-4586` branch (closes #4586).
7. Argus: review the PR.
8. Ema: self-approve CODEOWNERS.
9. Hermes: merge.
10. Hermes: confirm helm-smoke re-runs on PR #4585 (auto) and goes
    green. Ema self-approves CODEOWNERS. Merge. 4 GHSAs closed.

### Phase 2 — Per-agent App identities (~6 hours)

1. Ema: register 3 GitHub Apps via
   https://github.com/settings/apps/new:
   - `aegis-hermes` (icon: 🚚, homepage: link to team roster)
   - `aegis-argus` (icon: 👁️)
   - `aegis-hephaestus` (icon: 🔨)
2. Ema: install each on `OneStepAt4time/aegis` with the per-role
   permission matrix from this ADR.
3. Hermes: write `manage-aegis-apps.sh` for app lifecycle
   (registration check, PEM location, installation token mint).
4. Hermes: clone the `get-installation-token.sh` to
   `get-installation-token-hermes.sh`, `get-installation-token-argus.sh`,
   `get-installation-token-hephaestus.sh`. Each script returns 1h-TTL
   installation tokens for its App.
5. Hermes: update HEARTBEAT.md to reference the per-agent flow.
6. Hermes: file a follow-up ADR (or amend this one) for the
   per-agent CODEOWNERS rules — which agents can self-approve, which
   still need Ema.
7. Hermes: deprecate `aegis-gh-agent` (keep for 30 days, then remove).

**Review-gate preservation (cross-cutting, applies to all of Phase 2):**

- All 9 gates (from [9-gate Review Mechanics](#9-gate-review-mechanics))
  must still pass for per-agent App PRs — no gate relaxation.
- The CODEOWNERS layer is separate (Ema UI-approve for the merge,
  regardless of LGTM state).
- Per-agent App scope is per-role: Hermes = DevOps, Argus = Review /
  Merge gate, Hephaestus = Backend, etc. Each App's permissions
  reflect its lane. Per-role permission matrix is the same as the
  table in the Alternatives section.
- Bot self-approval matrix (see [App self-approval implication](#app-self-approval-implication))
  governs LGTM events; UI-approve remains Ema's.

### Open questions for Ema

1. **Phase 1 immediate unblock:** OK to grant `workflows: write` to
   `aegis-gh-agent` today? Or do you want to discuss per-agent scope
   first?
2. **Phase 2 priority:** when this week? Ema's calendar + Themis's
   review window are gating factors.
3. **Per-agent App naming:** `aegis-hermes[bot]`, `aegis-argus[bot]`,
   `aegis-hephaestus[bot]`, etc.? Or a single `aegis-agents[bot]` with
   a "creator" field? **Recommended default: per-agent Apps with
   per-role names** (cleaner audit trail; matches the existing
   `aegis-gh-agent` convention; no creator-field archaeology needed
   post-hoc — i.e., you can tell which agent authored which commit
   without parsing branch metadata). Ema confirms or picks an
   alternative.
4. **CODEOWNERS rule revision:** Phase 2 unblocks App self-approval.
   Should `* @OneStepAt4time` change to allow App self-approval for
   non-CI files? Ema + Argus should weigh in. See the
   [App self-approval implication](#app-self-approval-implication) matrix
   for the per-author × per-reviewer behavior (dependabot allowed,
   `aegis-gh-agent` blocked, per-agent Apps cross-allowed, human
   self-allowed, per-agent App same-blocked).
5. **PAT cleanup:** should Ema's `gho_` token in
   `~/.git-credentials` be removed once Phase 1 + 2 land? Themis
   flagged this as a P1 (2026-06-04).

## Reviewer commentary

### Argus (2026-06-05, 07:47 GMT+2)

Argus reviewed the proposal and offered two contributions integrated
above (see [9-gate Review Mechanics](#9-gate-review-mechanics) and
[7-batch concrete impact](#7-batch-concrete-impact)). Argus's reads on
the 5 open questions:

1. **Phase 1 OK today** — yes, low risk + high value. 10-min unblocks
   today's #4586 + all future CI/infra. The "consistency with existing
   `contents: write`" framing is the right one for the Ema pitch:
   not a new permission class, just a scope extension within the
   same security model.
2. **Phase 2 this week** — yes, gated on Themis's review window. The
   structural audit is the real value-add.
3. **Per-agent App naming** — `aegis-hermes[bot]`, `aegis-argus[bot]`,
   `aegis-hephaestus[bot]` looks clean and matches the existing
   `aegis-gh-agent` convention.
4. **CODEOWNERS rule revision** — yes, scoped to non-CI. CI/infra
   files retain human review per the security model. Most surgical
   change; smallest blast radius; preserves defense-in-depth.
5. **PAT cleanup** — yes, the `gho_` should go. Sequencing: only after
   Phase 1 + 2 land AND the script recipe is confirmed canonical for
   all paths. Don't remove the fallback before the replacement is
   proven.

Source: PR #4591 comment id 4628616053 (Argus 👁️ <1490089830472880218>,
filed via `app/aegis-gh-agent[bot]`).

## References

- ADR-0016: release-please with GitHub App token (precedent for App-based auth)
- ADR-0028: ACP-native session identity model (precedent for per-resource identity)
- HEARTBEAT.md (2026-06-02 06:00Z): script-based auth pattern adoption
- HEARTBEAT.md (2026-06-04 02:14Z): OAuth PAT and `get-installation-token.sh` discovery
- Themis perm sweep (2026-06-04 06:02Z): credential file perms clean
- HEARTBEAT.md (2026-06-05 05:30Z): #4586 push-blocked-by-App-permissions
- GitHub App settings: https://github.com/settings/apps/aegis-gh-agent

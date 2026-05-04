# ACP Major Cutover Release Plan

> Governance plan for
> [#2577](https://github.com/OneStepAt4time/aegis/issues/2577),
> ACP-003 in the Phase 3.5 ACP backend migration epic.

## Status and authority

This plan is the release-governance artifact required before ACP public-contract
PRs merge. It does not approve or merge implementation work. Maintainers must
approve this plan, then enforce the gates below as the ACP migration proceeds.

Parent references:

- Phase 3.5 epic:
  [`.claude/epics/phase-3-5-acp-backend-migration/epic.md`](../.claude/epics/phase-3-5-acp-backend-migration/epic.md)
- Positioning:
  [ADR-0023](adr/0023-positioning-claude-code-control-plane.md)
- Release process: [release-process.md](release-process.md)
- API versioning policy: [api-versioning.md](api-versioning.md)

Aegis remains the self-hosted control plane of Claude Code: a bridge, not an
agent framework, not an LLM orchestrator, and not a SaaS product. The ACP
cutover changes the runtime transport while preserving Aegis's REST, MCP,
dashboard, audit, RBAC, and team-control-plane identity.

## Why this is a major breaking release

The ACP cutover removes tmux as a shipped runtime, not just an internal
implementation detail. Existing public contracts currently expose tmux, window,
and pane concepts in REST responses, OpenAPI schemas, generated SDK types, MCP
tools, dashboard assumptions, health responses, doctor checks, deployment docs,
and troubleshooting workflows. Removing those concepts changes what clients can
request, what fields they receive, which tools are available, and which
operational prerequisites are valid.

The release is major and breaking because it removes or changes:

- tmux/window/pane response fields such as `windowId`, `windowName`,
  `windowExists`, `paneCommand`, and `HealthResponse.tmux`;
- pane-oriented REST endpoints and endpoint semantics, including
  `GET /v1/sessions/{id}/pane`;
- tmux/pane-oriented MCP tools and resources, including `capture_pane`;
- dashboard type assumptions based on tmux windows and panes;
- generated TypeScript and Python SDK models that expose tmux-specific fields;
- operator procedures that require tmux or psmux to inspect or recover
  sessions.

This is intentionally not shipped as a compatibility layer. The Phase 3.5 epic
explicitly rejects long-lived backend selection and tmux compatibility aliases
after cutover, so the public release must be treated as a major contract change.

## Why the REST namespace remains `/v1`

The cutover keeps the `/v1` REST namespace by explicit Phase 3.5 decision. The
runtime migration happens while Aegis is still in the preview lifecycle, and the
goal is to keep one canonical REST surface for the Claude Code control plane
rather than introduce a parallel `/v2/acp` namespace that would imply two
long-lived backend products.

For this release, "major" means the package, OpenAPI, SDK, MCP, dashboard, and
documentation contracts change together. It does not mean Aegis introduces a
new API family. The `/v1` namespace remains the stable product namespace for
the control-plane surface, while the major release and migration guide carry
the breaking-change signal for consumers.

This is a narrow, documented exception to the general API-versioning policy.
Future unrelated breaking API changes should continue to follow
[api-versioning.md](api-versioning.md) unless maintainers explicitly approve a
similar exception.

## Public contract removal plan

ACP public contracts must be designed around Aegis domain semantics:
session identity, normalized events, driver/observer control, pause,
intervention, approvals, terminal debug, health, and replay. Raw ACP details
may appear in safe diagnostics, but public consumers should depend on Aegis
events and actions rather than upstream protocol payloads.

### REST and OpenAPI

Remove tmux-specific fields from shared API schemas:

| Current contract | Cutover action | Replacement direction |
|---|---|---|
| `SessionInfo.windowId` | Remove | Use Aegis session ID and `displayName` |
| `SessionInfo.windowName` | Remove | Use `displayName` and event metadata |
| `SessionHealth.windowExists` | Remove | Use `SessionHealth.backend` and `SessionHealth.acp` |
| `SessionHealth.paneCommand` | Remove | Use action and event state |
| `HealthResponse.tmux` | Remove | Use backend, ACP, Postgres, and Redis health sections |
| `GET /v1/sessions/{id}/pane` | Remove | Use ACP terminal debug and event replay surfaces |
| tmux/pane semantics in bash or command-discovery flows | Remove or replace | Use ACP tool/result events and normalized terminal debug data |

Add or standardize ACP-native fields and endpoints only after the G3 approval
gate:

- `SessionInfo.backend = "acp"`;
- `SessionInfo.displayName`;
- `SessionInfo.state`;
- `SessionInfo.driver`;
- `SessionInfo.paused`;
- `SessionInfo.model`;
- `SessionInfo.provider`;
- `SessionInfo.transcriptId`;
- session event replay endpoint backed by the ACP event store;
- action endpoints for prompt, approval, pause, resume, cancel, and driver
  control;
- health sections for ACP runtime, Postgres source of truth, Redis realtime
  coordination, event lag, and action queue lag.

### MCP

Remove tmux-centric tools and descriptions. `capture_pane` and pane resource
semantics do not survive cutover. Existing MCP tools may remain only if their
semantics are backend-neutral after the REST contract changes.

ACP-native MCP tools should be introduced around the Phase 3.5 domain model:

- session creation and prompt submission;
- event subscription and replay;
- chat retrieval;
- approval response;
- driver claim, release, transfer, and revocation;
- pause, resume, and cancel;
- timeline retrieval;
- terminal debug retrieval.

Tool names and descriptions must avoid presenting Aegis as an agent framework.
They should describe Aegis as the control plane bridge to Claude Code.

### Dashboard

Dashboard work must stop treating the terminal pane as the primary product
surface. The cutover dashboard is ACP-native:

- Chat is the default human interaction surface.
- Terminal is a debug view, not a terminal mirror product.
- Timeline is the operator/audit view for driver changes, prompts, tools,
  approvals, pause/resume, interventions, runtime restarts, and health changes.

Dashboard types must be regenerated or updated from the same public contract
used by OpenAPI and SDKs. Dashboard PRs must not carry private tmux fields as a
shadow compatibility model.

### Generated SDKs

TypeScript and Python SDKs must be regenerated from the ACP major OpenAPI
contract in the same release train as the REST changes. SDK packages must not
ship tmux compatibility fields after cutover. Migration notes must show
consumers how to replace:

- window/pane identifiers with session IDs, display names, and event sequence
  numbers;
- pane capture with event replay, chat retrieval, and terminal debug data;
- keypress-style approval control with explicit approval action APIs;
- terminal health checks with ACP, event-store, action-queue, Postgres, and
  Redis health signals.

## Sequencing before public contract PRs merge

The following sequence is mandatory:

1. **ACP feasibility and release-governance approval**
   - #2576 produces ADR-0024 with the G1 green/yellow/red feasibility verdict.
   - #2577 approves this major cutover plan and satisfies G3 for the release
     policy, migration-guide, and SDK sequencing decision.
2. **Control-plane foundation**
   - #2584 defines ACP-native session identity.
   - #2585 through #2590 build SessionService, state machine, Postgres-backed
     source-of-truth stores, action queue, chat cache, and pause/intervention
     persistence.
   - Redis coordination issues that follow the foundation must preserve the
     rule that Redis is volatile coordination only, never source of truth.
3. **ACP runtime and terminal parity**
   - Runtime issues culminate in #2600 (action queue worker), #2601 (ACP
     terminal bridge), and #2602 (golden ACP event contract tests).
   - G4 must pass before M5 cutover: terminal echo, input, resize, reconnect,
     and debug output must have accepted parity.
4. **Breaking public contracts**
   - #2603 removes tmux fields from shared API contracts.
   - #2604 updates REST session routes.
   - #2605 removes pane capture and tmux-specific REST endpoints.
   - #2606 adds event replay.
   - #2607 adds ACP control action endpoints.
   - #2608 replaces tmux MCP tools with ACP-native tools.
   - #2609 regenerates OpenAPI and SDKs.
   - #2610 writes the customer-facing ACP migration guide.
5. **Dashboard and docs migration**
   - Dashboard issues must consume the same ACP session, event, approval,
     driver, pause, terminal-debug, and timeline contracts.
   - Documentation updates must remove tmux/psmux as runtime prerequisites only
     when the implementation actually cuts over.
6. **Cutover and deletion**
   - #2620 completes soak and cutover sign-off.
   - #2621 drains active tmux sessions or requires zero active tmux sessions.
   - #2622 through #2624 delete tmux runtime, terminal parser, VT100-only
     parser paths, tests, mocks, and fixtures.
   - #2625 updates doctor, deployment, Helm, and Windows setup.
   - #2626 aligns lifecycle docs.
   - #2627 runs the final gate and hygiene checks for the major cutover.

## Required gates

| Gate | Required before | Release-plan requirement |
|---|---|---|
| G1 — ACP feasibility verdict | M1 starts | #2576 / ADR-0024 must report green or an accepted yellow-with-mitigations verdict. Red aborts the epic. |
| G3 — Breaking API approval | Public contract PRs merge | Maintainers approve this plan, the `/v1` namespace exception, migration-guide scope, and SDK regeneration sequencing. |
| G4 — Raw terminal parity | M5 cutover | ACP terminal debug supports input echo, input delivery, resize, reconnect, and safe debug output with tests. |
| G5 — Soak completion | tmux deletion | Real workloads run through the ACP worktree with no blocking regressions, accepted event fidelity, and no unresolved security or data-loss issues. |
| G6 — Final gate | PRs to `develop` during cutover | `npm run gate` and pre-PR hygiene pass for cutover PRs. CI must pass on required platforms before merge. |

G3 is the only gate this PR is intended to satisfy. G1, G4, G5, and G6 remain
future implementation and release gates. G2 storage profile approval remains
governed by the parent epic and is not an ACP-003 release-policy gate.

## Release branch and tag flow

The ACP major release uses the existing release process. This plan does not
create a tag, bump a version, or bypass Release Please.

1. Public contract, dashboard, migration, and deletion PRs merge to `develop`
   only after their gates pass.
2. Maintainers confirm the intended major preview version and ensure `develop`
   has green required checks.
3. The **Create Release Branch** workflow creates `release/<version>` from
   `origin/develop`.
4. Release Please targets `release/<version>` and updates only release metadata:
   `.release-please-manifest.json`, `CHANGELOG.md`, `package.json`,
   `package-lock.json`, and `deploy/helm/aegis/Chart.yaml`.
5. Maintainers review and merge the Release Please PR into `release/<version>`.
6. A reviewed promotion PR moves release metadata to `main`.
7. Maintainers give explicit go/no-go.
8. Only after go/no-go, maintainers create the annotated `v*` tag on `main`.
9. The tag-triggered release workflow publishes npm, SDK, GitHub Release assets,
   Helm, SBOM, checksums, and attestations.

Planned previews use `X.Y.Z-preview`. Numbered preview tags are recovery-only
and require the documented recovery approval and annotated tag metadata.

## Rollback and abort criteria

### Abort before release

Abort the ACP cutover before release if any of the following is true:

- G1 is red, or yellow mitigations are not accepted by maintainers.
- G3 is not approved before public contract PRs attempt to merge.
- G4 terminal parity fails and no maintainer-approved scope reduction exists.
- G5 soak finds blocking data loss, authorization bypass, audit gaps, repeated
  ACP child crashes, unrecoverable event-store/action-queue drift, or unacceptable
  token/cost regression.
- G6 fails and the failure is not clearly unrelated to the cutover.
- Active tmux sessions cannot be drained safely.
- OpenAPI, SDKs, MCP reference, dashboard types, migration guide, and lifecycle
  docs cannot be made consistent in the same release train.

If the cutover aborts, do not delete tmux runtime code, do not create release
tags, and do not ship a long-lived `AEGIS_BACKEND` product mode. Keep work on
feature branches or revert unmerged contract PRs.

### Rollback after merge but before tag

If cutover PRs have merged to `develop` but no release tag exists, maintainers
may revert the merged cutover PRs or close/delete the release branch. No public
artifact has shipped, so the recovery should happen through normal reviewed PRs
and a fresh release branch after the issue is fixed.

### Recovery after public artifact publication

After a `v*` tag publishes public artifacts, do not move or recreate the tag.
Follow [release-process.md](release-process.md): rerun safe failed jobs when
possible, document unusable artifacts in an issue, and cut an approved recovery
release only when rerun or repair cannot make the published version usable.

## Operator and customer migration notes

The customer-facing migration guide (#2610) must include these notes at minimum:

- Back up Aegis state before upgrading.
- Finish, cancel, or explicitly drain active tmux sessions before installing the
  ACP cutover release.
- Remove operational dependencies on tmux and psmux after cutover; do not
  expect `tmux attach`, pane capture, or tmux socket inspection to work.
- Update scripts and clients that read `windowId`, `windowName`,
  `windowExists`, `paneCommand`, or `HealthResponse.tmux`.
- Replace pane capture workflows with ACP event replay, chat retrieval,
  terminal debug, and timeline endpoints.
- Replace keypress-based approvals with explicit approval action APIs or MCP
  tools.
- For team/enterprise deployments, configure and monitor Postgres as the durable
  source of truth and Redis as volatile realtime coordination.
- For local development, confirm the file/in-memory profile remains available
  without Redis or Postgres.
- Re-run `ag doctor` or equivalent health checks after upgrade.
- Regenerate or upgrade TypeScript and Python SDK clients from the ACP major
  release line before relying on removed tmux fields.
- Verify RBAC roles for send, approve, reject, kill, pause/resume, driver, and
  operator actions.
- Review dashboard operator workflows: Chat is primary, Terminal is diagnostic,
  and Timeline is the audit/operator view.

## Documentation acceptance checklist

Before the major release branch is cut, the following documentation must be
consistent:

- OpenAPI contract and generated SDK references reflect ACP contracts.
- MCP tools reference removes tmux/pane wording and documents ACP-native tools.
- Dashboard docs describe Chat, Terminal debug, Timeline, approvals,
  driver/observer, pause, and intervention.
- `docs/migration-guide.md` or a dedicated ACP migration guide contains the
  operator/customer steps above.
- Deployment, production, Windows, Helm, troubleshooting, README, CLAUDE,
  AGENTS, ROADMAP, SECURITY, and CONTRIBUTING no longer list tmux or psmux as
  prerequisites after #2625 and #2626.
- Release notes identify the cutover as a major breaking release and link to the
  migration guide.

## Approval outcome for ACP-003

ACP-003 is ready to close only when maintainers approve this plan in the PR for
#2577. Approval means:

- public contract PRs may proceed only after G1 also passes;
- the `/v1` namespace exception is accepted for the ACP major release;
- #2603 through #2610 have a release-sequencing plan;
- #2620 through #2627 have cutover, deletion, final-gate, and documentation
  dependencies documented;
- implementation work remains subject to its own review, tests, and gates.

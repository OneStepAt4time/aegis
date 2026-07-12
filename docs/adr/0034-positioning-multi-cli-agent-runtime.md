# ADR-0034: Positioning — Multi-CLI Agent Runtime (supersedes ADR-0023)

## Status

Accepted.

**Supersedes:** [ADR-0023](0023-positioning-claude-code-control-plane.md) (Positioning — Claude Code Control Plane, MIT, BYO LLM, `ag` CLI).

**Ratifies:** [ADR-0032](0032-multi-agent-architecture.md) (Multi-Agent Architecture) at the positioning layer.

**Supplements, does not replace:** [ADR-0006](0006-aegis-middleware-not-agent-framework.md), [ADR-0029](0029-solo-dev-first-phase-4-deferred.md), [ADR-0033](0033-positioning-vs-ecc.md).

> This is the first ADR in the repository to formally supersede another. The
> convention it establishes (`## Status` → `Supersedes:` + flipping the
> predecessor to `Deprecated`) is documented in [docs/adr/README.md](README.md).

## Context

ADR-0023 (Proposed 2026-04; never Accepted) locked Aegis to **Claude Code as
the single target runtime**. The stated rationale was focus and scope for a
part-time maintainer and a small (~8 star) audience: narrow the product so the
codebase and roadmap stay tractable.

That decision is now overtaken by two developments:

1. **ADR-0032 (Approved 2026-05-30, Boss review) already commits Aegis to
   multi-CLI at the architecture level.** Phase 3.5 shipped the substrate:
   `src/runners/` defines an `AgentRunner` interface and `RunnerRegistry`
   (issue #3263), with `GeminiCliRunner` and `CodexRunner` stubs. ADR-0032 §1
   frames multi-CLI as **existential reach**: *"Users choose the tool that
   supports their preferred AI coding agent. Without multi-agent, Aegis is
   invisible to anyone not using Claude Code."* The repository is therefore
   **internally contradictory** today: an Approved ADR mandates multi-CLI while
   a Proposed ADR and `.claude/rules/positioning.md` (the *"Never: competing
   CLIs"* bullet) forbid it.

2. **The wire-protocol landscape caught up.** July 2026 research confirms that
   **4 of 5 major coding-agent CLIs speak ACP** — the Agent Client Protocol
   (open standard, [Zed Industries](https://zed.dev/acp)) that Aegis already
   speaks to drive `claude-agent-acp`:

   | CLI | ACP | License | Headless | Approval/hooks | Aegis feasibility |
   |---|---|---|---|---|---|
   | Claude Code | via Zed adapter | Apache-2.0 adapter | yes | full (reference) | HIGH (current) |
   | Kimi Code CLI | **native** (`kimi acp`) | **MIT** | yes | approvals + plan mode, parity | **HIGH** |
   | Gemini CLI | **native** (`gemini --acp`) | Apache-2.0 | yes | 11 hooks, `setSessionMode`, sandbox | HIGH (caveat: sunset → `agy`) |
   | GitHub Copilot CLI | preview (`--acp`) | source-available; SaaS-only | yes | partial (perm-hook open) | MEDIUM (watch) |
   | OpenAI Codex CLI | no (custom JSONL; #30052 open) | Apache-2.0 | yes | sandbox/profiles/hooks | MEDIUM (needs bridge) |

   ACP is becoming the real common denominator for the **runtime-driving
   layer** (distinct from MCP, which stacks underneath as the agent↔tools
   layer). Aegis does not need a new protocol; it needs to host additional
   ACP-speaking children behind its existing `AcpBackend`/`AcpChildProcess`.

3. **Aegis's runtime is already ~85% protocol-agnostic.** The Claude-Code
   coupling lives in a thin spawn-boundary shell: binary resolution
   (`AEGIS_ACP_BIN` escape hatch already exists), `--permission-mode` argv,
   `ANTHROPIC_*`/`CLAUDE_*` env passthrough, `.claude/settings.local.json`
   patching, the transcript JSONL parser, and the `claude agents --json`
   discovery side-channel. The `AgentRunner` abstraction exists but is dead
   code (stubs only; production spawns `claude-agent-acp` directly). Hosting
   another ACP CLI is a spawn-boundary refactor, not a protocol rewrite.

The binding constraint on multi-CLI was therefore never wire-protocol
feasibility — it was the positioning policy in ADR-0023 + `positioning.md`.
This ADR removes that policy constraint and ratifies the direction ADR-0032
already locked in.

## Decisions

### 1. Positioning shift — control plane for ACP-compatible agent CLIs

Aegis is the **control plane for ACP-compatible coding-agent CLIs**. Claude
Code remains the **default and reference runtime**; it is no longer the only
one. The product noun moves from "control plane *of Claude Code*" to "control
plane *for ACP-compatible agent CLIs (Claude Code default)*".

### 2. Repeal the "Never: competing CLIs" rule

The bullet in [.claude/rules/positioning.md](../../.claude/rules/positioning.md)
marking *"First-class integrations with competing CLIs (e.g. Gemini CLI) —
Claude Code is the single target runtime"* as out-of-scope is **repealed**. It
is replaced with:

> First-class support for **ACP-compatible** agent CLIs — Claude Code
> (default), Kimi Code, Gemini CLI. Non-ACP CLIs (Codex today) enter via an
> ACP bridge, not a bespoke adapter. CLIs whose ACP surface is preview or
> SaaS-only (Copilot CLI) are watched, not built, until they stabilise.

The other two "Never" bullets (open-core `AEGIS_EDITION` flag; rewrite in
another language) **stay**.

### 3. Ratify ADR-0032

This ADR ratifies [ADR-0032](0032-multi-agent-architecture.md) at the
positioning layer. The `src/runners/` `AgentRunner` abstraction and the
Gemini/Codex stubs are the implementation substrate. `defaultRunner` remains
`'claude-code'` (ADR-0032 §4.2).

### 4. ACP-only first-class — no per-harness adapters

Affirms [ADR-0033](0033-positioning-vs-ecc.md) §3 no-fly-list item 3
(*"harness-specific shortcuts that break ACP"*). **First-class runners speak
ACP.** A CLI without native ACP (Codex today) is hosted via an ACP
bridge/adaptation layer upstream of the CLI, **not** a bespoke Aegis adapter
inside the runtime. This keeps the architecture one protocol, not N adapter
layers. `NdjsonRpcTransport` is reused across all runners (per ADR-0032).

### 5. Claude Code stays default and hard-installed

Claude Code remains the **default runner** and a **hard requirement to
install** (reference path; guarantees a working out-of-box runtime with no
extra auth setup). Other runners are opt-in and installed/registered by the
operator.

### 6. BYO LLM, per-runner — Aegis still owns no LLM cost

Reaffirms ADR-0023 Decision 4 and ADR-0031. Each runner owns its own model
auth and cost: Claude Code via `ANTHROPIC_*`; Kimi via Moonshot OAuth/API key;
Gemini via paid Gemini/Vertex key (post-2026-06-18 sunset); Codex via OpenAI
key. **Aegis passes auth through, does not proxy, cache, or own LLM cost.**
Per-runner cost tracking remains out of scope (ADR-0032 §4.4); `/v1/budgets`
(ADR-0031) provides alerts where runners expose usage.

### 7. MIT, single edition — unchanged

Multi-CLI does **not** introduce an `AEGIS_EDITION` flag. All runners ship to
all users. (Reaffirms ADR-0023 Decision 3 and ADR-0029 L66–70.)

### 8. Relationship to sibling ADRs

- **ADR-0006** (middleware, not framework): **survives unchanged.** The runner
  abstraction was always its escape hatch. Aegis still does not write agents,
  prompts, or LLM calls.
- **ADR-0029** (solo-dev-first, Phase 4 deferred): **survives.** Multi-CLI
  broadens reach *within* the solo-dev / small-team tier (operators running
  mixed harnesses); it does not pivot to enterprise.
- **ADR-0033** (positioning vs ECC): **survives; item 3 sharpened** by
  Decision 4 above. Aegis's differentiator remains governance/approval +
  multi-channel observation on a self-hosted server, not breadth-of-harness
  support at any cost.

### 9. Activate Phase 3.6 — Multi-CLI Runtime

Opens a **Phase 3.6** sub-track (sibling to Phase 3.5, which delivered the
ACP-native runtime precondition). Trigger condition: this ADR ratified **and**
ADR-0032 architecture shipped (already true). Milestones (per ADR-0032 §5):

- M1: wire `AgentRunner` into the spawn path (or parameterise `AcpBackend` via
  its existing `clientFactory`/`resolveCommand` seams) — replace the dead-code
  status of `src/runners/`.
- M2: implement `KimiRunner` concretely (replace stub) — strongest non-Claude
  candidate: native ACP, MIT, published capability matrix, approval/plan-mode
  parity.
- M3: implement `GeminiCliRunner` concretely (replace stub) — native ACP;
  track `agy` ACP gap ([google-antigravity/antigravity-cli#31](https://github.com/google-antigravity/antigravity-cli/issues/31)).
- M4: per-runner spawn adapters — env prefixes (`KIMI_*`/`GEMINI_*`),
  permission-mode mapping, and an **ACP-event-store-only mode** for non-Claude
  runners that bypasses the CC-specific transcript JSONL parser and
  `claude agents --json` discovery.
- M5: runner selection API + dashboard surface (create-session picks runner;
  session row shows runner).

Copilot CLI and Codex are explicitly **out of Phase 3.6 scope** (watch / bridge
respectively) and tracked in follow-up issues.

## Consequences

- **Positioning / market:** Aegis becomes addressable to any operator running
  an ACP-compatible coding agent, not only Claude Code users — the existential
  reach ADR-0032 identified. Target-user tier (solo dev → small team) is
  unchanged in priority but broadened in harness coverage.
- **Codebase:** revive and wire `src/runners/`; implement two concrete runners
  (Kimi, Gemini CLI); push the Claude-Code spawn-boundary coupling
  (binary-resolver, permission-mode argv, `ANTHROPIC_*` env, settings-patching,
  transcript, discovery) behind per-runner adapters; add an ACP-event-store-only
  mode so non-CC runners are not forced through CC-specific transcript/discovery
  paths.
- **Docs (single alignment PR with this ADR):**
  - [`.claude/rules/positioning.md`](../../.claude/rules/positioning.md): repeal
    the "Never" bullet (Decision 2); update "What Aegis is" / "What Aegis is
    NOT"; repoint the authority link from ADR-0023 to ADR-0034; drop the stale
    "general-purpose tmux manager" bullet (tmux removed in Phase 3.5 M5).
  - [`ROADMAP.md`](../../ROADMAP.md): add Phase 3.6; update the "Positioning
    (locked)" block.
  - [`CLAUDE.md`](../../CLAUDE.md): update the positioning summary line.
  - [`docs/enterprise/00-gap-analysis.md`](../enterprise/00-gap-analysis.md) §15:
    update the positioning lock-in section.
- **ADR-0023:** flipped to `Deprecated` with a superseded-by callout; kept for
  traceability.
- **Risks:**
  - ACP spec is pre-1.0 (0.x) — capability matrices differ per CLI; Aegis must
    degrade gracefully on unsupported methods (e.g. Kimi lacks `session/close`
    + `logout`; 10/12 stable).
  - Codex has no native ACP — bridge is third-party (`codex-acp`, ~142★,
    "breaking changes likely") until openai/codex#30052 lands.
  - Copilot CLI is SaaS-only / subscription-bound — conflicts with BYO-LLM;
    ACP is still preview. Watch, do not build.
  - Gemini CLI sunset to `agy` (free tier cut 2026-06-18); paid Gemini/Vertex
    still works; `agy` ACP tracked separately.
  - Per-runner maintenance surface grows; mitigated by ACP-only constraint
    (Decision 4) — no N-adapter explosion.
- **Unchanged:** MIT single edition; BYO LLM (Aegis owns no LLM cost);
  self-hosted first; not a SaaS; not an agent framework.

## Related

- Supersedes: [ADR-0023](0023-positioning-claude-code-control-plane.md)
- Ratifies: [ADR-0032](0032-multi-agent-architecture.md)
- Sharpens: [ADR-0033](0033-positioning-vs-ecc.md) §3
- Survives alongside: [ADR-0006](0006-aegis-middleware-not-agent-framework.md),
  [ADR-0029](0029-solo-dev-first-phase-4-deferred.md), [ADR-0031](0031-budget-alerts.md)
- Issues: #3263 (runner abstraction), #3180, #3971 (multi-agent demand),
  #4725 (reviewer App)
- External: [Agent Client Protocol](https://agentclientprotocol.com/),
  [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp),
  [Kimi Code ACP capability matrix](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html),
  [gemini-cli ACP](https://geminicli.com/docs/cli/acp-mode/),
  [copilot-cli ACP preview](https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-public-preview/),
  [openai/codex#30052](https://github.com/openai/codex/issues/30052)

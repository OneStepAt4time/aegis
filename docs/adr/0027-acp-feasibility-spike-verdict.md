# ADR-0027: ACP Feasibility Spike Verdict

## Status

Proposed

## Context

Issue [#2576](https://github.com/OneStepAt4time/aegis/issues/2576)
requested the Phase 3.5 ACP feasibility verdict originally referred to as
ADR-0024. `docs/adr/0024-dashboard-token-in-memory.md` already exists, so this
record uses the next available ADR number while satisfying the ACP-002
deliverable.

Aegis currently exposes Claude Code through a tmux-backed runtime. Phase 3.5
investigates replacing that backend with an Agent Client Protocol (ACP) child
process while preserving Aegis's control-plane responsibilities: session
lifecycle, event streaming, approvals, terminal diagnostics, BYO LLM
passthrough, and token/cost telemetry.

The M0 spike series answered whether ACP is viable before production
architecture work begins. The table separates each spike's stated result from
this ADR's production-readiness gate:

| Spike | Evidence | Stated spike result | ADR gate |
| --- | --- | --- | --- |
| ACP-010 child process lifecycle | `docs/spikes/acp-010-child-process-lifecycle.md` | Green | Green |
| ACP-011 event stream fixtures | `docs/spikes/acp-011-event-stream-fixtures.md` | Green | Green |
| ACP-012 approval parity | `docs/spikes/acp-012-approval-parity.md` | Green | Green |
| ACP-013 terminal extension parity | `docs/spikes/acp-013-terminal-extension-parity.md` | Green for harness semantics | Yellow until real-agent extension support is proven |
| ACP-014 custom model/BYO LLM passthrough | `docs/spikes/acp-014-custom-model-byo-llm-passthrough.md` | Green | Green |
| ACP-015 token/cost telemetry | `docs/spikes/acp-015-token-cost-telemetry.md` | Green for deterministic usage telemetry compatibility | Yellow-green until real-provider reconciliation is proven |

## Decision

Proceed with the ACP backend migration as a **yellow-green** architecture
program.

ACP is viable for Aegis's next backend, but production work must be gated behind
explicit contracts for the two areas that are not fully proven by live-agent
evidence yet: raw terminal parity and real-provider token/cost reconciliation.
The migration should move forward through the Phase 3.5 milestones rather than
attempting a tmux removal in one large PR.

### Green commitments

The following capabilities are sufficiently proven to design production
interfaces around ACP:

1. **Child process lifecycle.** Aegis can spawn an ACP child, exchange newline
   delimited JSON-RPC on stdio, initialize, create/resume/close sessions, send
   prompt turns, cancel in-flight prompts, and classify child failures.
2. **Structured event stream.** ACP frames can be captured and normalized into
   deterministic Aegis spike events for text, thinking, tool calls, tool
   results, approval requests, unknown update kinds, usage updates, and
   turn completion.
3. **Approval flow.** `session/request_permission` can be handled as a
   first-class JSON-RPC client request with explicit allow, deny, cancel,
   timeout, child-exit, and transport-disposal states. Terminal keypress
   emulation is not required for approvals.
4. **BYO LLM passthrough.** Model, provider, and allowlisted provider environment
   values can be passed through explicit ACP session metadata and child spawn
   environment without broad parent `process.env` inheritance.
5. **Token usage compatibility.** ACP `usage_update` frames can be normalized and
   transformed into the Claude JSONL `message.usage` shape consumed by
   `transcript.ts` `extractTokenDelta`.

### Yellow gates

The following must remain gates before tmux deletion:

1. **Raw terminal parity.** ACP-013 proves Aegis-side terminal extension
   semantics with deterministic fixtures, but the public ACP terminal methods
   are not enough by themselves for Aegis's raw dashboard terminal parity. The
   production backend must only enable the ACP terminal bridge when the agent
   advertises the required extension capability: input echo, resize, reconnect
   snapshot, and debug output.
2. **Real-provider cost reconciliation.** ACP-015 proves token-shape
   compatibility with deterministic fixtures. Production telemetry still needs a
   real-provider validation pass against provider/API telemetry or invoices
   within the tolerance approved for Phase 3.5.
3. **Schema drift.** The M0 fixtures intentionally normalize a narrow stable
   event projection. Future upgrades of `@agentclientprotocol/sdk` or
   `@agentclientprotocol/claude-agent-acp` must update raw fixtures, normalized
   fixtures, and compatibility tests together.

## Consequences

- M1/M2 work may define `AcpSessionStore`, `AcpBackend`, process supervision,
  action queue, fanout, and JSONL compatibility layers using the M0 spike
  contracts.
- tmux remains the production backend until the Phase 3.5 raw-terminal,
  approval, event replay, token/cost, and soak gates pass.
- ACP child stdout remains protocol-only. Diagnostics belong on stderr or typed
  ACP debug events.
- Approval data and provider configuration must be redacted and bounded before
  logging, persistence, REST responses, SSE/WebSocket fanout, or audit export.
- BYO LLM support remains first-class, but Aegis must keep explicit allowlists
  for provider environment variables and must not inherit arbitrary parent
  secrets into ACP children.
- The production token/cost model should preserve cost, provider, and model
  evidence in telemetry records instead of overloading Claude JSONL beyond the
  compatibility shim needed for existing consumers.

## Implementation guidance

1. Build the ACP runtime behind a backend interface and keep tmux available until
   the final cutover milestone.
2. Treat M0 spike files under `docs/spikes/` and
   `src/__tests__/fixtures/acp-event-stream/` as seed contracts for M2 golden
   tests.
3. Fail closed when required ACP capabilities are missing or malformed. Do not
   silently downgrade protocol errors into terminal-parser heuristics.
4. Keep JSON-RPC ids, pending approval ids, and session ids distinct in the
   production identity model.
5. Add live-package and real-provider probes before removing tmux code paths.

## Alternatives considered

### Stop the ACP migration

Rejected. M0 proved enough lifecycle, event, approval, BYO LLM, and usage
compatibility to justify proceeding.

### Remove tmux immediately

Rejected. Terminal parity and real-provider telemetry are not fully proven
against a production ACP agent. Immediate removal would create avoidable
regression risk.

### Keep tmux forever and only add ACP as diagnostics

Rejected for Phase 3.5. The control-plane model benefits from structured ACP
events and approval requests that avoid terminal scraping and keypress
emulation.

## Related

- [Phase 3.5 ACP backend migration epic](../../.claude/epics/phase-3-5-acp-backend-migration/epic.md)
- [ACP-010 child process lifecycle spike](../spikes/acp-010-child-process-lifecycle.md)
- [ACP-011 event stream fixture spike](../spikes/acp-011-event-stream-fixtures.md)
- [ACP-012 approval request/response parity spike](../spikes/acp-012-approval-parity.md)
- [ACP-013 terminal extension parity spike](../spikes/acp-013-terminal-extension-parity.md)
- [ACP-014 custom model/BYO LLM passthrough spike](../spikes/acp-014-custom-model-byo-llm-passthrough.md)
- [ACP-015 token and cost telemetry compatibility spike](../spikes/acp-015-token-cost-telemetry.md)
- Issue [#2576](https://github.com/OneStepAt4time/aegis/issues/2576)

# Detecting and Escaping Feedback Loops

When an Aegis session enters a feedback loop — repeating the same tool call indefinitely, echoing your messages back to you, or making no forward progress — you need a quick way to recognize the symptom, recover, and start fresh. This guide covers the user-facing detection and recovery path, plus a short **For operators** section with the internals.

**Audience:** Aegis users (CLI, dashboard, MCP clients, REST) running solo or in small teams. End users can stop reading before the **For operators** section.

---

## What a feedback loop looks like

A loop is happening when you observe either of these patterns in your session:

- **Repeated tool calls** — the same tool (e.g., `bash`, `read_file`, an MCP tool) is called 3 or more times in a 30-second window with no progress.
- **Echoed messages** — you see your own outgoing message text appear in the session output, immediately followed by another similar message.

Both are signs the agent's internal context has been driven into a self-reinforcing cycle — typically a model that treats its own just-delivered text as new input and re-issues a tool call.

> **Note:** A single retry (e.g., a tool call that fails once and succeeds on retry) is normal and is **not** a loop. Look for **3+ repetitions in 30 seconds with no forward progress**, or **echoed text being treated as new input**.

If you see the loop in a Discord or Telegram channel rather than the dashboard, the same symptoms apply — the channel is just where the model's output is being delivered.

---

## Recovery: pick the lightest tool that works

The recovery flow is **soft → hard**. Try the lightest option first; escalate only if the loop resumes.

| Step | Tool | Effect | Reversible? |
|------|------|--------|-------------|
| 1 | `interrupt_session` | Sends Ctrl+C to the current operation | Yes — session continues |
| 2 | `escape_session` | Sends Esc (dismiss prompts, cancel forms) | Yes — session continues |
| 3 | `kill_session` | Terminates the session, marks `killed` | No — must create a new session |
| 4 | `create_session` | Start a fresh session | (creates a new session ID) |

If the loop breaks after Step 1 or 2, you're done — no need to kill. If it resumes within a few tool calls, escalate to Step 3.

---

## Step 1 — Interrupt the current operation (soft)

Sends Ctrl+C to the running tool call and lets the model re-evaluate. The session stays alive and the transcript is preserved.

### MCP

```typescript
// Claude Code / MCP client
await use_mcp_tool("aegis", "interrupt_session", {
  sessionId: "abc123"
});
```

### REST

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/interrupt \
  -H "Authorization: Bearer $AEGIS_TOKEN"
```

**Response:** `{ "ok": true }` (200) or 404 if the session is not found.

### CLI

```bash
# There is no dedicated `ag interrupt` — use kill from the CLI when needed.
# (MCP and REST are the canonical interrupt surfaces; the dashboard Pause
#  button is the most user-friendly option — see below.)
```

### Dashboard

Open the session detail view and click the **Pause** button in the session control bar (`PauseControlBar`). The current tool call is interrupted; the session stays active.

---

## Step 2 — Send Escape (softer, prompt-specific)

Useful when the loop is a stuck prompt or interactive form rather than a runaway tool call. Sends an Esc keypress to dismiss the prompt.

### MCP

```typescript
await use_mcp_tool("aegis", "escape_session", {
  sessionId: "abc123"
});
```

### REST

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/escape \
  -H "Authorization: Bearer $AEGIS_TOKEN"
```

**Response:** `{ "ok": true }` (200) or 404.

### Dashboard

Press **Esc** while the session detail view has keyboard focus, or close the active prompt sheet.

---

## Step 3 — Kill the session (hard)

Terminates the Claude Code process, releases all session resources, and marks the session as `killed` in the audit log. The transcript is **retained** (status = `killed`) for audit but the session itself is terminal — you cannot resume the same session ID.

> **Once killed, a session cannot be recovered.** Move to Step 4 to start a new one.

### MCP

```typescript
await use_mcp_tool("aegis", "kill_session", {
  sessionId: "abc123"
});
```

### REST

```bash
# Primary endpoint
curl -X DELETE http://localhost:9100/v1/sessions/abc123 \
  -H "Authorization: Bearer $AEGIS_TOKEN"

# Aliases — all identical, pick whichever reads cleanest in your tooling:
#   POST /v1/sessions/:id/kill
#   POST /v1/sessions/:id/terminate
#   POST /v1/sessions/:id/stop
```

**Response:** `{ "ok": true, "status": "killed" }` (200).

| Status | Meaning |
|--------|---------|
| `200` | Session killed |
| `404` | Session is already in a terminal state (`killed`, `completed`, `crashed`) — no-op |
| `403` | Session belongs to a different API key |

### CLI

```bash
# ag kill supports prefix matching (issue #3672) — you can pass the
# first 8+ chars of the session ID instead of the full UUID.
ag kill abc123
# Output: ✅ Session abc12345… killed.
```

If you don't know the session ID:

```bash
# List active sessions (hides terminal states by default; pass --all to see killed)
ag list
```

### Dashboard

Open the session list and click the **X (close session)** button on the looped session's row. The session is marked `killed` and removed from the active list. The transcript is still accessible from the audit log.

### Permission required

`kill_session` requires the API key to have the `kill` permission. If you get a 403 "missing kill permission", ask your aegis operator to grant the permission to your key, or use `interrupt_session` (which requires only `send`) as a softer alternative.

---

## Step 4 — Start a fresh session

Do not reuse the looped session ID. The session context (the model state) is what caused the loop, and a fresh session starts from a clean context.

### MCP

```typescript
await use_mcp_tool("aegis", "create_session", {
  workDir: "/path/to/your/project",
  // ... your normal session config
});
```

### REST

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "workDir": "/path/to/your/project" }'
```

**Required fields:** `workDir` (the absolute path to the project directory the session should operate in). Optional fields include `name`, `prompt`, `permissionMode`, `model`, `autoApprove`, `systemPrompt`, and more — see the [API Reference](./api-reference.md#create-session) for the full schema.

### CLI

```bash
ag run --workdir /path/to/your/project
```

(`ag run` is the canonical "create + immediately start" CLI command; `ag init` is for project-level setup, not session creation.)

---

## What to do if the loop recurs

If the loop recurs in the new session with **the same input**, this is likely a structural issue with your prompt, workDir, or environment config — not a transient agent hiccup. File an issue at [github.com/OneStepAt4time/aegis/issues](https://github.com/OneStepAt4time/aegis/issues) with:

- The session ID(s) of the looped sessions
- A redacted transcript of the first ~50 lines
- Your aegis version (`ag --version` or check the dashboard footer)
- The model being used (if known — visible in the session detail view)

If the loop recurs **without** the same input (i.e., it happens on totally different prompts), that's a stronger signal of a structural problem and should be escalated more urgently — tag the issue `area:docs` and `P1` so it gets triaged quickly.

---

## Why this happens

Feedback loops of this class have one root cause: **the model treats its own just-delivered text as a new user input and re-issues a tool call**. This typically happens when one or more of the following are true:

1. **The model's context window is full** and earlier context — including the "you have finished, stop now" signal — has been dropped or compressed.
2. **The agent runtime's `delivery-mirror` mechanism** (which echoes outgoing agent text back into the model's input) is the structural source of the echo. In a healthy model, this echo is ignored; in a constrained model, the echo is treated as new input and triggers another tool call.
3. **The same MCP/REST tool is called repeatedly** with effectively the same arguments — often a search or read tool that returns non-empty results but the model doesn't recognize as "no progress."

Aegis itself does not contain a feedback-loop bug. The risk lives in the interaction between the agent runtime, the model's context handling, and the tool-call surface.

---

## What's being done about it

The four structural mitigations being rolled out for this class of issue are upstream in **OpenClaw** (the agent runtime aegis orchestrates), tracked under OpenClaw P1 #91827:

1. **Content dedup at the gateway** — drop identical `message` payloads to the same target within a 30-second window, model-agnostic. This is the load-bearing fix: it would have stopped the feedback loop on the second iteration with zero model involvement.
2. **Hide `delivery-mirror` from the model-visible transcript** — make it a transcript artifact (auditable in the log, visible to humans in a transcript viewer) rather than a model input that the next model turn reads as a user message.
3. **Per-turn duplicate-call guard** — if the same agent emits the same `message` payload N times in a row (configurable; default N=3) without an intervening user turn, abort the run with a structured error.
4. **`ag-manudis` added to `agentToAgent.allow`** — let the orchestrator inject stop signals into stuck sessions directly, so recovery does not depend on the model noticing the loop.

These are upstream changes in OpenClaw and will reach aegis as a downstream dependency update. Until then, the recovery steps above are the user-facing mitigation.

For the full reproduction and the ask-by-ask detail, see the upstream spec at `~/.openclaw/workspace-hermes/drafts/openclaw-p1-feedback-loop-structural-fix.md` (internal).

---

## For operators

> **Collapsible section.** This section is for operators running aegis at scale or diagnosing incident patterns. End users can stop reading here.

### Echo-back canary pattern

When monitoring a fleet of agent sessions, the operator can detect an impending loop **before** the gateway-level content dedup fires by watching each session's own transcript for **echo-back rows**. The canary:

1. Watches the session's `message` tool calls.
2. After each `message` tool result, checks the **next user-side row** of the transcript.
3. **Canary fires** if that row contains a verbatim or near-verbatim copy of the agent's outgoing text — including `delivery-mirror` rows (`provider: openclaw, model: delivery-mirror`). That's the echo-back signal: the model is treating its own output as new input.

When the canary fires, the operator's mitigation is:

1. **Post a single sentinel message** to the channel: `@ag-manudis: STUCK IN ECHO-LOOP, session-id X, request abort`.
2. **Halt** all further tool calls. Don't try to recover by reasoning — the structural fix is upstream, not in-loop.

The canary is the **model-side fast path**; OpenClaw P1 #91827 ask #1 (content dedup) is the **gateway-side safety net**. Both layers together = defense in depth: the canary fires on iteration 2 inside the agent's own context, the safety net catches any agent that doesn't have the canary.

### Operational recovery

If a session is detected looping and the canary is not fast enough, the operator can:

- Use `ag list` (or `GET /v1/sessions`) to identify the looped session by its `lastActivity` timestamp stalling.
- Apply `ag kill <id>` or `POST /v1/sessions/:id/interrupt` (softer) depending on whether you need the transcript for post-mortem.
- For a stuck session that is not responding to `kill_session`, escalate to the operator's runbook (see `docs/incident-rollback-runbook.md`).

If the loop is happening at scale (multiple sessions looping simultaneously), that's a structural signal — escalate immediately to the team lead and check for upstream OpenClaw regressions.

### Source of truth

The echo-back canary rule is maintained in Argus's self-improving memory at `~/self-improving-ag-argus/memory.md` (see the "Echo-Back Canary Rule" entry, refined 2026-06-10 with Boss endorsement). This doc summarizes the user-facing surface; the canonical rule lives in the agent's self-improving file. The rule is intended to propagate to a new `~/self-improving-ag-argus/domains/loop-detection.md` file in a calm maintenance pass.

---

## See also

- [Troubleshooting Guide](./troubleshooting.md) — for stuck sessions, stalled state, and other session issues
- [API Reference — Kill Session](./api-reference.md#kill-session) — full REST API documentation for kill
- [MCP Tools — kill_session](./mcp-tools.md#kill_session) — full MCP tool documentation
- [MCP Tools — interrupt_session](./mcp-tools.md#interrupt_session) — Ctrl+C surface
- [MCP Tools — escape_session](./mcp-tools.md#escape_session) — Esc surface
- [Phone Approvals](./guides/phone-approvals.md) — for session control from Telegram
- [Incident Rollback Runbook](./incident-rollback-runbook.md) — operator-facing recovery playbooks

---

**Last updated:** 2026-06-10 · **Context:** post-incident documentation for the 2026-06-10 03:00–03:30 UTC feedback loop incident (OpenClaw P1 #91827)

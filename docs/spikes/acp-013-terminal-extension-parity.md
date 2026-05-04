# ACP-013 Terminal Extension Parity Spike

Issue: [#2581](https://github.com/OneStepAt4time/aegis/issues/2581)  
Epic: `.claude/epics/phase-3-5-acp-backend-migration/epic.md`  
Milestone: M0 spike

## Summary

ACP-013 verifies the raw terminal parity gate called out in Phase 3.5: input
echo, resize, reconnect/resubscribe, and debug output. This PR adds a focused
probe harness in `src/acp-terminal-extension-probe.ts`, deterministic Vitest
coverage in `src/__tests__/acp-terminal-extension-probe.test.ts`, and fixture
support in `src/__tests__/fixtures/fake-acp-agent.mjs`.

The harness intentionally does not implement the final dashboard terminal UI and
does not remove tmux. It models the terminal extension contract that M2 can turn
into `AcpTerminalBridge` and M4 can expose through the dashboard debug tab.

## Probe contract

The probe expects an ACP agent to advertise:

```json
{
  "agentCapabilities": {
    "terminalExtension": {
      "inputEcho": true,
      "resize": true,
      "reconnect": true,
      "debugOutput": true
    }
  }
}
```

After `initialize` and `session/new`, the probe exercises:

1. `terminal/open` to allocate a raw terminal stream.
2. `terminal/input` followed by a `terminal/event` notification with
   `kind: "input_echo"`.
3. `terminal/resize` followed by a `terminal/event` notification with
   `kind: "resize"`.
4. `terminal/resubscribe` followed by a `terminal/event` notification with
   `kind: "reconnect_snapshot"`.
5. `terminal/debug` notification forwarding.
6. `terminal/close` and `session/close` cleanup.

The method and event names are deliberately contained in the spike harness so
future implementation work can rename or translate them without touching the
dashboard.

## Findings

| Area                     | Finding                          | Evidence                                                                                                                                      | Follow-up                                                                                            |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Input echo               | Green for harness semantics      | Fake ACP fixture echoes `terminal/input` through a typed `input_echo` event and the test asserts byte-for-byte parity.                        | M2 `AcpTerminalBridge` should preserve byte strings and avoid terminal-parser inference.             |
| Resize                   | Green for harness semantics      | The fixture accepts `columns` and `rows`, emits a typed resize event, and the probe rejects malformed shapes.                                 | M2 should normalize dashboard resize actions into this bridge call and audit the requested geometry. |
| Reconnect/resubscribe    | Green for harness semantics      | `terminal/resubscribe` returns a `reconnect_snapshot` with buffered output and the latest dimensions.                                         | M2 fanout should store enough terminal state to replay snapshots to reconnecting observers.          |
| Debug output             | Green for harness semantics      | `terminal/debug` notifications are captured separately from stdout/stderr and exposed in the probe result.                                    | M4 should route debug output to a dashboard debug tab, not to the primary chat stream.               |
| Unsupported extension    | Green for failure classification | Missing `agentCapabilities.terminalExtension` raises `ACP terminal extension is not supported`.                                               | M2 should fail closed and keep tmux runtime as the active backend until the capability is present.   |
| Malformed event          | Green for failure classification | Invalid terminal event payloads raise `ACP terminal event was malformed` with the expected event kind.                                        | M2 should preserve explicit protocol errors for telemetry and operator diagnostics.                  |
| Child exit during stream | Green for failure classification | Child exit while waiting for terminal output raises `ACP child process exited during terminal stream` with exit code and expected event kind. | M2 supervision should map this to terminal stream failure and session health degradation.            |

## ACP limitations observed

- The public ACP terminal methods documented at
  `https://agentclientprotocol.com/protocol/terminals.md` are agent-to-client
  command execution helpers. They are not, by themselves, enough for Aegis raw
  dashboard terminal parity because they do not define operator input echo,
  dashboard resize, reconnect snapshots, or terminal-debug forwarding.
- This spike therefore treats raw terminal parity as an ACP extension capability
  that must be explicitly advertised before use.
- The fake fixture proves Aegis-side protocol handling and failure
  classification. It does not prove that `@agentclientprotocol/claude-agent-acp`
  currently implements these extension methods.
- Real-agent validation should use `scripts/acp-terminal-extension-probe.mjs`
  after `npm run build` once an ACP agent exposes the terminal extension.

## Handoff

### M2: `AcpTerminalBridge`

- Use `src/acp-terminal-extension-probe.ts` as the seed contract for a runtime
  bridge, then replace spike-only result objects with domain events consumed by
  `AcpFanout`.
- Keep malformed extension messages as structured protocol errors. Do not
  silently downgrade them into generic stream closures.
- Preserve reconnect snapshots as first-class bridge output so observer
  reconnects do not depend on tmux pane capture.

### M4: dashboard debug tab

- Treat `terminal/debug` as diagnostic output for operators. It should be
  visible in the dashboard debug tab and excluded from normal chat messages.
- Keep the final dashboard terminal as a debug/diagnostic surface, not a tmux
  mirror or primary interaction model.

## Validation commands

```bash
npm test -- src/__tests__/acp-terminal-extension-probe.test.ts
npm test -- src/__tests__/acp-lifecycle-probe.test.ts
npm run gate
```

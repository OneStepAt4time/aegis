# ACP-015 Token and Cost Telemetry Compatibility Spike

Issue: [#2583](https://github.com/OneStepAt4time/aegis/issues/2583)

## Verdict

**Green for deterministic ACP usage telemetry compatibility.** ACP does not write
Claude JSONL, but a `usage_update` ACP event can be normalized into a stable Aegis
spike event and transformed into the Claude JSONL usage shape consumed by
`transcript.ts` `extractTokenDelta`.

This remains an M0 spike. It does not implement the production `AcpBackend`,
durable telemetry storage, dashboard cost rendering, provider billing
reconciliation, or real-provider validation.

## Durable spike artifacts

- `src/acp-event-stream.ts` — normalizes ACP `usage_update` events into
  `type: "usage_update"` with token usage plus optional cost, model, and provider
  evidence. It also exports `acpUsageEventsToClaudeJsonl`, a structural adapter
  that produces Claude JSONL-compatible usage entries.
- `src/__tests__/fixtures/fake-acp-agent.mjs` — emits a deterministic
  `usage_update` frame for the `emit-event-stream` prompt without secrets.
- `src/__tests__/fixtures/acp-event-stream/event-stream.raw.ndjson` — commits the
  raw ACP usage frame alongside the existing event-stream golden fixture.
- `src/__tests__/fixtures/acp-event-stream/event-stream.normalized.json` —
  commits the normalized Aegis spike projection for deterministic regression
  tests.
- `src/__tests__/acp-lifecycle-probe.test.ts` — proves raw fixture capture,
  normalized fixture stability, and compatibility with `extractTokenDelta`.

## Fixture shape

The fake ACP child emits `usage_update` using intentionally mixed field naming so
the spike remains tolerant of ACP schema drift:

```json
{
  "sessionUpdate": "usage_update",
  "usage": {
    "input_tokens": 1200,
    "outputTokens": 340,
    "cache_creation_input_tokens": 128,
    "cacheReadInputTokens": 512
  },
  "cost": {
    "totalCostUsd": 0.012345,
    "currency": "USD"
  },
  "model": "claude-sonnet-4-6",
  "provider": "anthropic"
}
```

The normalized event is stable and uses Aegis field names:

```json
{
  "type": "usage_update",
  "sessionId": "fixture-session",
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 340,
    "cacheCreationTokens": 128,
    "cacheReadTokens": 512
  },
  "cost": {
    "amountUsd": 0.012345,
    "currency": "USD"
  },
  "model": "claude-sonnet-4-6",
  "provider": "anthropic"
}
```

## Mapping to `transcript.ts`

`transcript.ts` `extractTokenDelta(raw: JsonlEntry[])` sums
`entry.message.usage` fields from Claude JSONL assistant messages. ACP usage
events can feed that model through this deterministic mapping:

| Normalized ACP usage field | Claude JSONL field |
| -------------------------- | ------------------ |
| `usage.inputTokens` | `message.usage.input_tokens` |
| `usage.outputTokens` | `message.usage.output_tokens` |
| `usage.cacheCreationTokens` | `message.usage.cache_creation_input_tokens` |
| `usage.cacheReadTokens` | `message.usage.cache_read_input_tokens` |

The adapter emits structural Claude JSONL-compatible entries with
`type: "assistant"`, `message.role: "assistant"`, empty text content, and the
usage object above. Feeding the deterministic fixture through
`extractTokenDelta` returns:

```json
{
  "inputTokens": 1200,
  "outputTokens": 340,
  "cacheCreationTokens": 128,
  "cacheReadTokens": 512
}
```

Cost, model, and provider fields remain normalized event evidence for future
cost models. They are not consumed by `extractTokenDelta`, which is token-only.

## Schema tolerance

The spike accepts finite non-negative numeric token fields from `usage`,
`tokenUsage`, `token_usage`, or the update object itself. It recognizes common
camelCase and snake_case variants for input, output, cache creation, and cache
read tokens. Cost evidence supports common USD amount names and currency names
from `cost`, `costUsage`, `cost_usage`, or the update object itself.

Unknown ACP update kinds retain the ACP-011 behavior: they still normalize as
`type: "unknown"`. Existing ignored update kinds remain ignored.

## Limitations

- The fixture is synthetic and deterministic. It proves compatibility mechanics,
  not provider billing accuracy.
- Cost handling is evidence capture only. It does not convert currencies,
  reconcile billing exports, or compute costs from token prices.
- The adapter intentionally targets the current `extractTokenDelta` token model.
  A future production cost model should keep cost and provider evidence in a
  dedicated telemetry record instead of overloading Claude JSONL.
- Field-name tolerance is conservative. New ACP schema names should be added
  with fixtures when upstream packages change.
- Real-provider validation still requires local credentials and must avoid
  printing or committing secrets.

## Pass/fail notes

Pass criteria from the Phase 3.5 epic:

1. **Validate token/cost data availability:** pass for deterministic ACP
   `usage_update` fixtures with token, cost, model, and provider evidence.
2. **Feed transcript/cost model within accepted tolerance:** pass for token
   accounting; `extractTokenDelta` returns the exact expected token delta from
   the adapter output.
3. **Fixtures committed for deterministic tests:** pass; raw and normalized
   event-stream fixtures include the usage update.

## Validation evidence

Commands run in this worktree:

```text
npm test -- src\__tests__\acp-lifecycle-probe.test.ts
npx tsc --noEmit
npm run gate
```

Results:

- Targeted ACP lifecycle and event stream tests passed: 30 tests.
- TypeScript type-check passed.
- Full quality gate passed.

Manual real-provider validation:

- Not run for this M0 spike. Run a real ACP provider prompt later and compare
  live `usage_update` token totals against the provider invoice or API telemetry
  within the tolerance chosen by the production telemetry design.

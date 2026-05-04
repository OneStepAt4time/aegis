# ACP-014 Custom Model and BYO LLM Passthrough Spike

Issue: [#2582](https://github.com/OneStepAt4time/aegis/issues/2582)

## Verdict

**Green for deterministic passthrough evidence.** The ACP lifecycle probe can now
send an explicit Claude Code model, a provider label, and allowlisted BYO LLM
environment values to an ACP child process without printing provider secrets.

This remains a spike. It does not add final provider orchestration, persistent
runtime configuration, dashboard controls, cost normalization, or a production
`AcpBackend`.

## Durable spike artifacts

- `src/acp-lifecycle-probe.ts` — adds `model`, `modelProvider`, and
  `providerEnv` probe options; validates the provider matrix; emits redacted
  passthrough summaries; and redacts sensitive protocol error payloads.
- `scripts/acp-lifecycle-probe.mjs` — adds `--model`, `--provider`, and
  repeatable `--provider-env KEY=VALUE` flags for local provider checks.
- `src/__tests__/fixtures/fake-acp-agent.mjs` — verifies the ACP child sees
  model/provider metadata and allowlisted env values while reporting only
  booleans and keys.
- `src/__tests__/acp-lifecycle-probe.test.ts` — covers model selection,
  provider env allowlisting, secret redaction, and invalid input handling.

## Passthrough contract tested

The probe passes model configuration in ACP `session/new` metadata:

```json
{
  "_meta": {
    "aegis": {
      "modelProvider": "openrouter"
    },
    "claudeCode": {
      "options": {
        "model": "openai/gpt-4.1-mini",
        "env": {
          "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
          "ANTHROPIC_AUTH_TOKEN": "<redacted>",
          "ANTHROPIC_DEFAULT_MODEL": "openai/gpt-4.1-mini",
          "ANTHROPIC_DEFAULT_FAST_MODEL": "openai/gpt-4.1-mini",
          "API_TIMEOUT_MS": "60000"
        }
      }
    }
  }
}
```

The same allowlisted `providerEnv` values are also present in the ACP child
process environment. The fake ACP child verifies raw receipt by returning
booleans such as `spawnEnvAuthTokenSeen` and `optionEnvAuthTokenSeen`; it never
returns token values.

## Provider matrix

All providers use the existing Aegis BYO LLM contract from `docs/byo-llm.md`:
provider-native variables stay outside Aegis and are mapped into the
allowlisted `ANTHROPIC_*` variables before the probe or future runtime receives
them.

| Provider     | Probe provider id | Allowlisted child env                                                                                                     | Deterministic evidence                                                                                                                    | Real-provider status                                                                                              |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Anthropic    | `anthropic`       | `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_MODEL`, `ANTHROPIC_DEFAULT_FAST_MODEL`, `API_TIMEOUT_MS` | Model/provider metadata reaches `session/new`; empty provider/model inputs are rejected.                                                  | Manual validation required with a real token and model.                                                           |
| GLM / Zhipu  | `glm`             | Same allowlist                                                                                                            | Matrix accepts the provider id and would pass only mapped `ANTHROPIC_*` values.                                                           | Manual validation required; map `GLM_API_KEY` to `ANTHROPIC_AUTH_TOKEN` before invoking the probe.                |
| OpenRouter   | `openrouter`      | Same allowlist                                                                                                            | Fake child verifies `ANTHROPIC_AUTH_TOKEN` reaches both process env and `_meta.claudeCode.options.env`; `OPENROUTER_API_KEY` is rejected. | Manual validation required; map `OPENROUTER_API_KEY` to `ANTHROPIC_AUTH_TOKEN` before invoking the probe.         |
| LM Studio    | `lm-studio`       | Same allowlist                                                                                                            | Matrix accepts the provider id and would pass only mapped `ANTHROPIC_*` values.                                                           | Manual validation required with a running local server.                                                           |
| Ollama       | `ollama`          | Same allowlist                                                                                                            | Fake child verifies mapped local-model values reach both process env and `_meta.claudeCode.options.env`.                                  | Manual validation required with a running local server.                                                           |
| Azure OpenAI | `azure-openai`    | Same allowlist                                                                                                            | Matrix accepts the provider id and would pass only mapped `ANTHROPIC_*` values.                                                           | Manual validation required; map deployment names to `ANTHROPIC_DEFAULT_MODEL` and `ANTHROPIC_DEFAULT_FAST_MODEL`. |

## Security and redaction notes

- The new `providerEnv` path is an explicit allowlist. It rejects provider-native
  secret names such as `OPENROUTER_API_KEY`.
- Supported env keys are exactly `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_MODEL`,
  `ANTHROPIC_DEFAULT_FAST_MODEL`, and `API_TIMEOUT_MS`.
- `API_TIMEOUT_MS` must be a positive integer string.
- Model and provider inputs must be non-empty and must not contain control
  characters.
- Probe summaries redact sensitive keys with `[REDACTED]`.
- JSON-RPC error payloads from the ACP child are recursively redacted by key and
  by sensitive provider values supplied through `providerEnv`.
- The probe still reports stderr byte counts in the CLI summary rather than raw
  stderr. The in-process test API retains bounded stderr for lifecycle
  assertions, matching ACP-010 behavior.
- `D:\aegis\.claude\settings.local.json` was not copied, printed, summarized, or
  committed.

## Manual real-provider validation

Run these commands from this worktree after `npm run build`. Substitute values in
your shell without committing them or pasting output that contains secrets.

### Anthropic

```powershell
$anthropicToken = $env:ANTHROPIC_AUTH_TOKEN
node scripts\acp-lifecycle-probe.mjs `
  --provider anthropic `
  --model claude-sonnet-4-6 `
  --provider-env ANTHROPIC_AUTH_TOKEN=$anthropicToken `
  --provider-env ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-6 `
  --prompt "Reply with exactly: AEGIS_ACP_PROBE_OK" `
  --timeout-ms 120000
```

Expected non-secret result: `prompt.stopReason` is `end_turn`, exit code is `0`,
and `modelPassthrough.env.ANTHROPIC_AUTH_TOKEN` is `[REDACTED]`.

### OpenRouter

```powershell
$openRouterToken = $env:OPENROUTER_API_KEY
node scripts\acp-lifecycle-probe.mjs `
  --provider openrouter `
  --model openai/gpt-4.1-mini `
  --provider-env ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1 `
  --provider-env ANTHROPIC_AUTH_TOKEN=$openRouterToken `
  --provider-env ANTHROPIC_DEFAULT_MODEL=openai/gpt-4.1-mini `
  --provider-env ANTHROPIC_DEFAULT_FAST_MODEL=openai/gpt-4.1-mini `
  --provider-env API_TIMEOUT_MS=120000 `
  --prompt "Reply with exactly: AEGIS_ACP_PROBE_OK" `
  --timeout-ms 180000
```

Expected non-secret result: `prompt.stopReason` is `end_turn`, exit code is `0`,
the provider is `openrouter`, and native `OPENROUTER_API_KEY` does not appear in
the summary.

### Local OpenAI-compatible providers

For LM Studio or Ollama, start the local server first, then map the local model
identifier into the same `ANTHROPIC_*` variables:

```powershell
$env:OLLAMA_OPENAI_COMPAT_URL = "http://127.0.0.1:11434/v1"
node scripts\acp-lifecycle-probe.mjs `
  --provider ollama `
  --model qwen2.5-coder:7b `
  --provider-env ANTHROPIC_BASE_URL=$env:OLLAMA_OPENAI_COMPAT_URL `
  --provider-env ANTHROPIC_AUTH_TOKEN=ollama-local `
  --provider-env ANTHROPIC_DEFAULT_MODEL=qwen2.5-coder:7b `
  --provider-env ANTHROPIC_DEFAULT_FAST_MODEL=qwen2.5-coder:7b `
  --provider-env API_TIMEOUT_MS=180000 `
  --prompt "Reply with exactly: AEGIS_ACP_PROBE_OK" `
  --timeout-ms 240000
```

Expected non-secret result: `prompt.stopReason` is `end_turn`, exit code is `0`,
and the local provider receives no provider-native secret variable.

## Limitations

- The provider label is diagnostic metadata for Aegis and future M2 runtime
  configuration. `@agentclientprotocol/claude-agent-acp` routes calls through
  Claude Code settings and env, not through a provider field.
- The spike does not infer provider settings from native env names. Operators
  must continue mapping native variables to the `ANTHROPIC_*` contract.
- The probe validates passthrough mechanics; it does not guarantee model quality,
  token accounting, tool behavior, or provider-specific compatibility quirks.
- Real-provider validation depends on local credentials, upstream availability,
  and local model servers. The committed evidence stays deterministic.

## Handoff requirements for M2 runtime configuration

1. Keep the runtime API explicit: accept a provider id, model id, and mapped
   `ANTHROPIC_*` env values instead of broad environment inheritance.
2. Reuse the allowlist and redaction behavior from this probe for logs, health,
   diagnostics, and dashboard summaries.
3. Treat provider-native env names as inputs to external examples or local
   operator scripts, not as session env keys accepted by Aegis.
4. Store only non-secret provider metadata in session state. Tokens should remain
   in process environment, secret stores, or operator-managed config.
5. When M2 adds a production `AcpBackend`, send model overrides through
   `_meta.claudeCode.options.model` and mapped env through
   `_meta.claudeCode.options.env`.

## Validation evidence

Commands run in this worktree:

```text
npm test -- src/__tests__/acp-lifecycle-probe.test.ts
npx tsc --noEmit
```

Results:

- deterministic fixture tests passed;
- TypeScript type-check passed;
- redaction tests confirmed sensitive provider tokens are absent from summaries
  and protocol error details;
- real-provider testing was not run in this change because no non-secret local
  provider health evidence is available in the repository.

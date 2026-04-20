# BYO LLM with OpenAI-compatible providers

Aegis does not proxy model traffic or translate one provider API into another.
The supported pattern is simpler: pass Claude Code an OpenAI-compatible base
URL, token, and model names, then let Claude Code talk to that provider
directly.

This is the official contract Aegis supports today:

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_BASE_URL` | OpenAI-compatible base URL Claude Code should call |
| `ANTHROPIC_AUTH_TOKEN` | Provider token/key Claude Code should send as bearer auth |
| `ANTHROPIC_DEFAULT_MODEL` | Main model identifier or deployment name |
| `ANTHROPIC_DEFAULT_FAST_MODEL` | Faster/cheaper fallback model identifier |
| `API_TIMEOUT_MS` | Request timeout for the upstream provider |

These five variables are explicitly allowlisted by the session env denylist.

## Why the env names stay `ANTHROPIC_*`

Aegis intentionally blocks many provider-native secret names at session-create
time (`OPENAI_API_KEY`, `AZURE_*`, `AWS_*`, `GITHUB_*`, and similar). That is a
security boundary, not a bug.

The safe pattern is:

1. Keep provider-native names outside Aegis.
2. Map them into the neutral `ANTHROPIC_*` variables before Aegis sees them.
3. Start Aegis or create a session with those mapped values.

That is why the examples in [`examples/byo-llm/`](../examples/byo-llm/README.md)
take inputs like `OPENROUTER_API_KEY` or `AZURE_OPENAI_API_KEY`, but only pass
the allowlisted `ANTHROPIC_*` keys into Aegis.

## Two ways to apply the pattern

### 1. Server-wide default via `aegis.config.json`

Use this when every session on the server should route to the same provider.

```json
{
  "defaultSessionEnv": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
    "ANTHROPIC_AUTH_TOKEN": "<provider-token>",
    "ANTHROPIC_DEFAULT_MODEL": "openai/gpt-4.1-mini",
    "ANTHROPIC_DEFAULT_FAST_MODEL": "openai/gpt-4.1-mini",
    "API_TIMEOUT_MS": "60000"
  }
}
```

### 2. Per-session override via `POST /v1/sessions`

Use this when different sessions should talk to different providers or models.

```bash
curl -X POST http://127.0.0.1:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "workDir": "/path/to/project",
    "env": {
      "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
      "ANTHROPIC_AUTH_TOKEN": "<provider-token>",
      "ANTHROPIC_DEFAULT_MODEL": "openai/gpt-4.1-mini",
      "ANTHROPIC_DEFAULT_FAST_MODEL": "openai/gpt-4.1-mini",
      "API_TIMEOUT_MS": "60000"
    }
  }'
```

## Official examples

The repository ships runnable templates for:

- GLM / Zhipu
- OpenRouter
- LM Studio
- Ollama
- Azure OpenAI

Build once, then use the example runner:

```bash
npm run build
node examples/byo-llm/run-example.mjs --list
node examples/byo-llm/run-example.mjs openrouter -- --port 9200
```

The runner resolves `${VAR}` placeholders from your shell, writes a temporary
config under `.tmp/byo-llm/`, starts Aegis with that config, and removes the
generated file when the server exits.

## Provider recipes

### GLM / Zhipu

- Required input: `GLM_API_KEY`
- Optional inputs: `GLM_BASE_URL`, `GLM_MODEL`, `GLM_FAST_MODEL`,
  `GLM_TIMEOUT_MS`
- Default example base URL: provider OpenAI-compatible endpoint at
  `https://open.bigmodel.cn/api/paas/v4`

```bash
export GLM_API_KEY="<glm-api-key>"
node examples/byo-llm/run-example.mjs glm
```

If your GLM account exposes a different compatibility path (for example an
explicit `/v1` suffix), set `GLM_BASE_URL` to that exact base.

### OpenRouter

- Required input: `OPENROUTER_API_KEY`
- Optional inputs: `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`,
  `OPENROUTER_FAST_MODEL`, `OPENROUTER_TIMEOUT_MS`
- Default example base URL: `https://openrouter.ai/api/v1`

```bash
export OPENROUTER_API_KEY="<openrouter-api-key>"
node examples/byo-llm/run-example.mjs openrouter
```

Use any model string your OpenRouter account can access.

### LM Studio

- Optional inputs: `LM_STUDIO_BASE_URL`, `LM_STUDIO_API_KEY`,
  `LM_STUDIO_MODEL`, `LM_STUDIO_FAST_MODEL`, `LM_STUDIO_TIMEOUT_MS`
- Default example base URL: `http://127.0.0.1:1234/v1`

```bash
export LM_STUDIO_MODEL="your-loaded-model-id"
node examples/byo-llm/run-example.mjs lm-studio
```

LM Studio often runs without auth; the example uses a harmless placeholder
token by default. Replace the model with the exact identifier shown by LM
Studio.

### Ollama

- Optional inputs: `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, `OLLAMA_MODEL`,
  `OLLAMA_FAST_MODEL`, `OLLAMA_TIMEOUT_MS`
- Default example base URL: `http://127.0.0.1:11434/v1`

```bash
export OLLAMA_MODEL="qwen2.5-coder:7b"
node examples/byo-llm/run-example.mjs ollama
```

If you use a different local model, swap `OLLAMA_MODEL` and
`OLLAMA_FAST_MODEL` to match what you already pulled.

### Azure OpenAI

- Required input: `AZURE_OPENAI_API_KEY`
- Optional inputs: `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_DEPLOYMENT`,
  `AZURE_OPENAI_FAST_DEPLOYMENT`, `AZURE_OPENAI_TIMEOUT_MS`
- Default example base URL:
  `https://YOUR-RESOURCE.openai.azure.com/openai/v1`

```bash
export AZURE_OPENAI_API_KEY="<azure-openai-key>"
export AZURE_OPENAI_BASE_URL="https://your-resource.openai.azure.com/openai/v1"
export AZURE_OPENAI_DEPLOYMENT="your-deployment-name"
node examples/byo-llm/run-example.mjs azure-openai
```

Important: `ANTHROPIC_DEFAULT_MODEL` maps to the Azure deployment name, not the
marketing model label. If your Azure setup still requires an `api-version`
query string or custom header behavior, put a tiny OpenAI-compatible proxy in
front of it and point `AZURE_OPENAI_BASE_URL` at that proxy instead.

## Troubleshooting

- **400 from Aegis on session create**: make sure you passed only the
  allowlisted `ANTHROPIC_*` + `API_TIMEOUT_MS` keys into `env`.
- **401 / 403 from the provider**: confirm the mapped token is valid for that
  provider.
- **404 on `/chat/completions`**: your base URL is probably missing the
  provider's OpenAI-compatible path (often `/v1`).
- **Model not found**: use the provider's exact model or deployment identifier.
- **LM Studio / Ollama never connect**: confirm the local server is already
  listening before you start Aegis.

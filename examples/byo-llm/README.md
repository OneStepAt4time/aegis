# BYO LLM examples

These templates show the supported Aegis pattern for OpenAI-compatible
providers:

1. start from provider-native inputs (`OPENROUTER_API_KEY`,
   `AZURE_OPENAI_API_KEY`, `OLLAMA_MODEL`, etc.),
2. map them into the allowlisted `ANTHROPIC_*` session env vars,
3. launch Aegis with those resolved values.

## Files

- `glm.aegis.config.json`
- `openrouter.aegis.config.json`
- `lm-studio.aegis.config.json`
- `ollama.aegis.config.json`
- `azure-openai.aegis.config.json`
- `run-example.mjs` — resolves `${VAR}` placeholders and starts Aegis

The raw config files are safe to commit because they contain only placeholders,
never real credentials.

## Usage

```bash
npm run build
node examples/byo-llm/run-example.mjs --list
OPENROUTER_API_KEY="<token>" node examples/byo-llm/run-example.mjs openrouter
LM_STUDIO_MODEL="your-model-id" node examples/byo-llm/run-example.mjs lm-studio
AZURE_OPENAI_API_KEY="<token>" \
AZURE_OPENAI_BASE_URL="https://your-resource.openai.azure.com/openai/v1" \
AZURE_OPENAI_DEPLOYMENT="your-deployment" \
node examples/byo-llm/run-example.mjs azure-openai
```

Pass extra Aegis CLI arguments after `--`:

```bash
OPENROUTER_API_KEY="<token>" \
node examples/byo-llm/run-example.mjs openrouter -- --port 9200
```

Use `--print-config` if you only want to inspect the fully resolved
`aegis.config.json` payload.

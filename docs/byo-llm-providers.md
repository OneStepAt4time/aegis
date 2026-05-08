<!-- aegis:allow-credential-scan -->
# BYO LLM Provider Configuration

Aegis supports Bring-Your-Own (BYO) LLM providers through the ACP (Agent Client Protocol) layer. All providers use Anthropic-compatible environment variables mapped through the ACP child process.

## Supported Providers

| Provider | `modelProvider` value | Example Model |
|----------|----------------------|---------------|
| Anthropic | `anthropic` | `claude-sonnet-4-6` |
| GLM (ZhipuAI) | `glm` | `glm-4-plus` |
| OpenRouter | `openrouter` | `openai/gpt-4.1-mini` |
| LM Studio | `lm-studio` | `llama-3.3-70b-instruct` |
| Ollama | `ollama` | `qwen2.5-coder:7b` |
| Azure OpenAI | `azure-openai` | `gpt-4.1` |

## Environment Variables

All providers share the same set of mapped environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_BASE_URL` | Provider API endpoint URL | Yes |
| `ANTHROPIC_AUTH_TOKEN` | API key / auth token | Yes (except local providers) |
| `ANTHROPIC_DEFAULT_MODEL` | Default model identifier | Yes |
| `ANTHROPIC_DEFAULT_FAST_MODEL` | Fast/cheap model for quick tasks | No |
| `API_TIMEOUT_MS` | Request timeout in milliseconds | No |

## Provider-Specific Endpoints

### Anthropic
```
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

### GLM (ZhipuAI)
```
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

### OpenRouter
```
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
```

### LM Studio (local)
```
ANTHROPIC_BASE_URL=http://127.0.0.1:1234/v1
```

### Ollama (local)
```
ANTHROPIC_BASE_URL=http://127.0.0.1:11434/v1
```

### Azure OpenAI
```
ANTHROPIC_BASE_URL=https://my-deployment.acme.com/openai/deployments/gpt-4.1
```

## Usage Example

```bash
# Create a session with OpenRouter provider
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/path/to/project",
    "modelProvider": "openrouter",
    "model": "openai/gpt-4.1-mini",
    "providerEnv": {
      "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
      "ANTHROPIC_AUTH_TOKEN": "sk-or-...",
      "ANTHROPIC_DEFAULT_MODEL": "openai/gpt-4.1-mini",
      "ANTHROPIC_DEFAULT_FAST_MODEL": "openai/gpt-4.1-mini"
    }
  }'
```

## Security

- Provider-native env keys (e.g., `OPENROUTER_API_KEY`, `AZURE_OPENAI_API_KEY`) are **rejected** — only the mapped Anthropic-compatible keys are allowlisted
- Auth tokens are **redacted** in logs, error messages, and API responses
- Provider environment is isolated from the parent Aegis process

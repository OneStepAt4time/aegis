# Examples

Reference examples for integrating and orchestrating Aegis.

## Layout

- `openclaw-agent/`
  - `SOUL.md`: ready-to-adapt dev agent template
  - `HEARTBEAT.md`: session supervision loop template
  - `openclaw.json`: example OpenClaw configuration for Aegis workflows
- `claude-code-skill/`
  - `aegis-workflow.md`: end-to-end orchestration skill
  - `aegis-task.md`: single-task execution skill
- `byo-llm/`
  - `*.aegis.config.json`: provider templates for GLM, OpenRouter, LM Studio, Ollama, Azure OpenAI
  - `run-example.mjs`: resolves `${VAR}` placeholders and launches Aegis with the chosen template
  - `README.md`: setup notes and usage
- `standalone/`
  - `simple-agent.ts`: minimal create/read flow (<50 lines)
  - `ci-runner.ts`: CI-oriented session runner with exit codes
  - `multi-session-pipeline.ts`: parallel session orchestration with batch polling
  - `python-client.py`: Python REST API client with permission handling
  - `webhook-listener.ts`: HTTP server for receiving Aegis webhook events
  - `README.md`: run instructions and environment variables

## Quick Start

All standalone examples work against a running Aegis instance:

```bash
# Start Aegis
ag

# Run an example (in another terminal)
export AEGIS_BASE_URL=http://127.0.0.1:9100
npx tsx examples/standalone/simple-agent.ts /path/to/project
```

See [`standalone/README.md`](./standalone/README.md) for the full list and usage details.

## Notes

These examples are based on production patterns already used in this repository's `skill/references` templates and API flow. All examples use the REST API directly — no SDK dependency required.

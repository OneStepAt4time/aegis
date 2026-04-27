# aegis-python-client

Official Python client for [Aegis](https://github.com/OneStepAt4time/aegis) — orchestration middleware for Claude Code.

## Install

```bash
pip install aegis-python-client
```

## Quick Start

```python
from aegis_python_client import AegisClient

client = AegisClient(
    base_url="http://localhost:9100",
    auth_token="your-token",
)

# List all sessions
sessions = client.list_sessions()
for s in sessions.get("sessions", []):
    print(s["id"], s.get("name", ""))

# Create a new session
result = client.create_session(
    work_dir="/path/to/project",
    name="my-session",
)
session_id = result["id"]

# Send a message
client.send_message(session_id, "Implement feature X")

# Get session metrics
metrics = client.get_session_metrics(session_id)
print(metrics)
```

## Features

- **Zero external HTTP dependencies** — uses only `urllib` from stdlib
- **Pydantic v2 models** — all request/response types generated from OpenAPI spec
- **Full API coverage** — 53 endpoints: sessions, pipelines, templates, memory, auth, monitoring
- **Type-safe** — full type annotations throughout

## Regenerating Models

When `openapi.yaml` changes at the repo root:

```bash
cd packages/python-client
pip install 'datamodel-code-generator[http]'
datamodel-codegen \
  --input ../../openapi.yaml \
  --output src/aegis_python_client/models.py \
  --output-model-type pydantic_v2.BaseModel
```

## License

MIT

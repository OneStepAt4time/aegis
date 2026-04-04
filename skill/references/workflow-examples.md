# Workflow Examples

Concrete end-to-end examples using Aegis API + skill templates.

## 1) Implement Issue

1. Create session with issue prompt.
2. Poll status with heartbeat loop.
3. Auto-approve permission prompts.
4. Read summary and transcript tail.

```bash
SID=$(curl -s -X POST http://127.0.0.1:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/repo/aegis",
    "name": "impl-issue-742",
    "prompt": "Implement issue #742 with tests and minimal diff"
  }' | jq -r '.id')

bash skill/references/heartbeat.sh "$SID" 900
curl -s http://127.0.0.1:9100/v1/sessions/$SID/summary | jq
```

## 2) Review PR

1. Create review-focused session.
2. Ask for severity-ordered findings.
3. Export compact summary.

```bash
SID=$(curl -s -X POST http://127.0.0.1:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/repo/aegis",
    "name": "review-pr-1060",
    "prompt": "Review PR #1060 for regressions; list findings by severity"
  }' | jq -r '.id')

curl -s -X POST http://127.0.0.1:9100/v1/sessions/$SID/send \
  -H "Content-Type: application/json" \
  -d '{"text":"Focus on behavior regressions and missing tests."}'
```

## 3) Batch Pipeline

1. Create pipeline with dependent stages.
2. Query pipeline status until completion.

```bash
curl -s -X POST http://127.0.0.1:9100/v1/pipelines \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ci-like",
    "workDir": "/repo/aegis",
    "stages": [
      {"name":"lint", "prompt":"Run lint and fix minimal issues"},
      {"name":"test", "prompt":"Run tests and fix failures", "dependsOn":["lint"]},
      {"name":"docs", "prompt":"Update docs for changed API", "dependsOn":["test"]}
    ]
  }' | jq
```

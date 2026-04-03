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
- `standalone/`
  - `simple-agent.ts`: minimal create/read flow (<50 lines)
  - `ci-runner.ts`: CI-oriented session runner with exit codes
  - `README.md`: run instructions

## Notes

These examples are based on production patterns already used in this repository's `skill/references` templates and API flow.

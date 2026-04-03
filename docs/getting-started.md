# Getting Started With Aegis

This guide takes you from zero to a working Aegis session in less than 5 minutes.

Prerequisites:
- Node.js 20+
- Claude Code CLI installed
- tmux installed and available in PATH

## 1. Install And Start Aegis

```bash
npm install -g aegis-bridge
aegis-bridge start
```

By default Aegis listens on http://localhost:9100.

## 2. Connect Aegis To Claude Code (MCP)

```bash
claude mcp add aegis -- npx aegis-bridge mcp
```

After this step, Claude Code can orchestrate Aegis sessions through MCP tools.

## 3. Create Your First Session

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"first-session","workDir":"/path/to/project","prompt":"Inspect this project and summarize what needs attention."}'
```

Save the returned session id (for example `abc123`).

## 4. Send A Follow-Up Prompt

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/send \
  -H "Content-Type: application/json" \
  -d '{"text":"Now propose a step-by-step plan and start with step 1."}'
```

## 5. Read Results

```bash
curl http://localhost:9100/v1/sessions/abc123/read
```

You can also open the dashboard at http://localhost:9100 and inspect the session in real time.

## Permission Handling

When Claude Code requests approval, Aegis exposes explicit endpoints:

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/approve
# or
curl -X POST http://localhost:9100/v1/sessions/abc123/reject
```

In the dashboard, approval prompts are shown inline with Approve/Reject actions.

## Multiple Sessions In Parallel

Create more sessions with different `name` and `workDir` values. Aegis is designed for parallel orchestration.

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"backend","workDir":"/path/to/backend","prompt":"Fix failing tests"}'

curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"frontend","workDir":"/path/to/frontend","prompt":"Improve loading states"}'
```

## Troubleshooting FAQ

1. `tmux: command not found`
Install tmux and verify `tmux -V` works in your shell.

2. `Claude Code CLI not found`
Install Claude Code and ensure `claude --version` is available.

3. `401 Unauthorized` from API
Set a valid token in your client or dashboard before calling protected endpoints.

4. Session shows as stalled
Use `/v1/sessions/:id/interrupt` or send a follow-up prompt to unstick execution.

5. MCP tools not visible in Claude Code
Re-run `claude mcp add aegis -- npx aegis-bridge mcp` and restart Claude Code.

6. Dashboard does not load
Check that Aegis is running on port 9100 and no local firewall/proxy blocks localhost.

7. Screenshot endpoint returns 501
Install Playwright dependencies on the machine hosting Aegis.

8. Session creation reuses an old session
This is expected for idle sessions with same `workDir`; set a different `workDir` if you need a new one.

9. `EADDRINUSE` on startup
Port 9100 is already in use. Stop the conflicting process or set another port.

10. No output from `/read`
Wait for the session to produce transcript entries or inspect `/v1/sessions/:id/pane` for terminal-level output.

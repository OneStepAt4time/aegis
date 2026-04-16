# Troubleshooting Guide

Common issues and how to resolve them.

---

## Server Issues

### Server won't start — port already in use

```bash
Error: listen EADDRINUSE :::9100
```

**Cause:** Another process is using port 9100.

**Fix:**
```bash
# Find the process
lsof -i :9100
# Kill it
kill -9 <PID>
# Or start Aegis on a different port
AEGIS_PORT=9200 npx @onestepat4time/aegis
```

---

### Server starts but tmux reports unhealthy

```json
{ "status": "ok", "tmux": { "healthy": false, "error": "no tmux" } }
```

**Cause:** tmux is not installed or not in PATH.

**Fix:**
```bash
# Install tmux
sudo apt install tmux  # Ubuntu/Debian
brew install tmux       # macOS

# Verify tmux is available
tmux -V
```

---

### Sessions created but immediately show as stalled

**Cause:** `workDir` is not accessible or doesn't exist.

**Fix:**
- Verify the directory exists: `ls /path/to/workdir`
- Check `AEGIS_ALLOWED_WORKDIRS` includes the path (or use default: `$HOME`, `/tmp`, `cwd`)
- `allowedWorkDirs` changes in config are hot-reloaded without restart

---

## Authentication Issues

### 401 Unauthorized on all endpoints

**Cause:** Auth is enabled but no token provided, or token is wrong.

**Fix:**
```bash
# Verify token is set
echo $AEGIS_AUTH_TOKEN

# Test with correct header
curl -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  http://localhost:9100/v1/health
```

---

### Auth token works for some endpoints but not others

**Cause:** Non-admin keys have limited scopes. Some endpoints require `admin` role.

**Fix:** Create an admin key:
```bash
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "admin-key", "role": "admin"}'
```

---

### Config.json changes don't take effect

**Cause:** Most config fields are read only at startup. `allowedWorkDirs` is hot-reloaded via file watcher.

**Fix:** For `allowedWorkDirs`, edits take effect automatically within ~1 second. For other fields, restart the server after editing config:
```bash
# Find and kill the process
pkill -f "aegis" && sleep 2
# Restart
npx @onestepat4time/aegis
```

---

## Session Issues

### Session creation returns 400 Bad Request

**Cause:** Missing required field `workDir`.

**Fix:**
```bash
# workDir is required
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/tmp/test", "prompt": "Hello"}'
```

---

### Session stuck in "stalled" state

**Cause:** Claude Code is not producing output (idle or blocked).

**Fix:**
```bash
# Interrupt the session
curl -X POST http://localhost:9100/v1/sessions/<id>/interrupt \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Or kill and recreate
curl -X POST http://localhost:9100/v1/sessions/<id>/kill \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

---

### Transcript returns 0 messages despite activity

**Cause:** JSONL file is being written but byte offset tracking may be stale.

**Fix:**
```bash
# Check if JSONL file exists
ls -la ~/.aegis/sessions/<id>/*.jsonl

# Verify the file has content
wc -l ~/.aegis/sessions/<id>/*.jsonl

# Try reading with offset=0 to force re-read
curl "http://localhost:9100/v1/sessions/<id>/read?offset=0"
```

---

### Permission request never returns

**Cause:** No approval channel configured, or approval not sent.

**Fix:**
```bash
# Check session status
curl http://localhost:9100/v1/sessions/<id>/health \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Send approval if using manual approval mode
curl -X POST http://localhost:9100/v1/sessions/<id>/approve \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

---

## MCP Issues

### MCP tool calls fail with "Session not found"

**Cause:** MCP server can't reach Aegis, or session ID is wrong.

**Fix:**
```bash
# Verify Aegis is running
curl http://localhost:9100/v1/health

# Check MCP server can reach Aegis
curl -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  http://localhost:9100/v1/sessions
```

---

### MCP connection refused

**Cause:** Aegis not running or wrong port.

**Fix:**
```bash
# Verify Aegis is listening
curl http://localhost:9100/v1/health

# Check port in Aegis config
# Default: 9100
```

---

## Webhook / Notification Issues

### Webhooks not firing

**Cause:** Webhook URL not configured, or endpoint unreachable.

**Fix:**
```bash
# Configure webhooks
AEGIS_WEBHOOKS="https://example.com/hook" npx @onestepat4time/aegis

# Test webhook delivery manually
curl -X POST http://localhost:9100/v1/alerts/test \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Check alert stats
curl http://localhost:9100/v1/alerts/stats \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

---

### Slack notifications not working

**Cause:** `AEGIS_SLACK_WEBHOOK_URL` not set, or webhook URL expired.

**Fix:**
```bash
# Set Slack webhook
export AEGIS_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# Restart Aegis
```

---

## CLI Issues

### CLI command hangs or times out

**Cause:** Aegis server not running, or network connectivity issue.

**Fix:**
```bash
# Verify server is running
curl http://localhost:9100/v1/health

# Try with explicit URL
AEGIS_URL=http://localhost:9100 npx @onestepat4time/aegis sessions list
```

---

### CLI returns "Unauthorized" but token is set

**Cause:** Token not passed to server, or token mismatch.

**Fix:**
```bash
# Verify token matches
echo $AEGIS_AUTH_TOKEN
# Should match what's set in Aegis server config
```

---

## Performance Issues

### High memory usage with many sessions

**Cause:** Sessions accumulate without cleanup. No idle timeout configured.

**Fix:**
```bash
# Set idle timeout (default: 10 minutes)
AEGIS_IDLE_TIMEOUT_MS=300000 npx @onestepat4time/aegis

# Set max sessions
AEGIS_MAX_SESSIONS=10 npx @onestepat4time/aegis
```

---

### Slow session creation

**Cause:** Cold start of Claude Code, or network latency.

**Fix:**
- First session after server start is always slower (CLI initialization)
- Subsequent sessions are faster
- Check network latency to Anthropic API

---

## Docker / Deployment Issues

### Docker container exits immediately

**Cause:** tmux not available inside container.

**Fix:** Run container with tmux installed, or use host networking:
```bash
docker run --network=host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  onestepat4time/aegis
```

---

## Getting Help

If this guide doesn't resolve your issue:

1. **Check the logs:** Aegis outputs structured JSON logs. Look for `errorCode` fields.
2. **Enable debug mode:** `AEGIS_LOG_LEVEL=debug npx @onestepat4time/aegis`
3. **Open an issue:** Include server logs, OS version, and reproduction steps.

# Known Issues

This page documents active bugs with workarounds. Issues are removed once fixed and released.

> **Last updated:** 2026-05-14 · **Aegis version:** v0.6.7-preview.1

---

## `/read` Returns Empty Messages

**Issue:** [#3422](https://github.com/OneStepAt4time/aegis/issues/3422) · **Status:** Open · **Severity:** P2

`GET /v1/sessions/:id/read` returns `{ "messages": [] }` even when the session has transcript data.

### Workaround

Use the `/transcript` endpoint instead:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/sessions/:id/transcript
```

The `/transcript` endpoint returns the full JSONL transcript with all messages. `/read` will be fixed in a future release.

---

## `ag run` Fails with Unauthorized After `ag init`

**Issue:** [#3342](https://github.com/OneStepAt4time/aegis/issues/3342) · **Status:** Fixed in v0.6.7 · **Severity:** P2

After running `ag init` a second time, `ag run` and `ag create` may return `401 Unauthorized` even though `ag doctor` passes.

### Cause

The server loads auth keys at startup and does not hot-reload when `ag init` writes new keys. The token file (`~/.aegis/auth-token`) may differ from the token the server loaded.

### Workaround

**Restart the server** after every `ag init`:

```bash
# Kill the running server
kill $(cat ~/.aegis/aegis.pid) 2>/dev/null

# Start fresh
ag
```

If the token still doesn't work, set it explicitly:

```bash
export AEGIS_AUTH_TOKEN=$(grep authToken ~/.aegis/config.yaml | awk '{print $2}')
ag run "your prompt" --cwd /path/to/project
```

---

## `ag init --force` Crashes with DUPLICATE_KEY_NAME

**Issue:** [#3351](https://github.com/OneStepAt4time/aegis/issues/3351) · **Status:** Fixed in v0.6.7 · **Severity:** P2

Running `ag init --force` when an admin key already exists crashes with `DUPLICATE_KEY_NAME`.

### Workaround

Delete the existing key before re-running:

```bash
# Remove the stale admin key
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/auth/keys/ag-init-admin

# Now re-run init
ag init --force
```

Or delete `~/.aegis/keys.json` and restart the server (this removes **all** API keys).

---

## `ag create` Shows No Output

**Issue:** [#3357](https://github.com/OneStepAt4time/aegis/issues/3357) · **Status:** Open · **Severity:** P2

`ag create "prompt"` exits with code 0 but prints nothing. The session is created successfully but the CLI doesn't display the session ID.

### Workaround

Check for the session via the API:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/sessions?limit=5
```

---

## Unrecognized CLI Arguments Create Sessions

**Issue:** [#3352](https://github.com/OneStepAt4time/aegis/issues/3352) · **Status:** Open · **Severity:** P2

Typing an unrecognized CLI argument (e.g., `ag status`, `ag list`) creates a session with that word as the prompt instead of showing an error.

### Workaround

Check available commands before running:

```bash
ag --help
```

If you accidentally created a session, kill it:

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:9100/v1/sessions/<session-id>
```

---

## Reporting a Bug

Found a new issue? [Open a bug report](https://github.com/OneStepAt4time/aegis/issues/new?template=bug_report.md) on GitHub.

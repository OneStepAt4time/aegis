# Demo Script: Mobile Approval Flow

> Walkthrough script for recording a public demo of Aegis mobile approval.
> Target duration: 3-4 minutes. Branch: `docs/2007-demo-recording`.

## Setup (pre-recording)

Complete these steps before hitting record:

1. **Terminal layout**: Open two side-by-side panes:
   - Left: tmux session showing Aegis server logs (`ag serve` or `npm run dev`).
   - Right: API interaction pane for curl commands.
2. **Phone**: Have Telegram open on your phone, logged into the Aegis bot group. Place it on a mount visible to camera or plan to cut to screen recording.
3. **Environment**: Set `AEGIS_TG_BOT_TOKEN`, `AEGIS_TG_GROUP_ID`, and `AEGIS_API_KEYS`. Server running on `localhost:9100`.
4. **Clean state**: Kill any existing sessions: `curl -s localhost:9100/v1/sessions | jq '.[].id' -r | xargs -I{} curl -s -X DELETE localhost:9100/v1/sessions/{}`.

---

## Section 1: Introduction (0:00 - 0:30)

### Narration

> "This is Aegis -- the control plane for Claude Code. It lets you run AI coding agents on your server and manage them from anywhere. Today I'm going to show you the mobile approval flow: how you can start a session, get a prompt on your phone when Claude asks for permission, and approve or reject -- all without touching your laptop."

### On screen

- **[S01]** Aegis logo or README header.
- **[S02]** Terminal showing `ag serve` running, health check passing.

```
$ curl -s localhost:9100/v1/health | jq
{
  "status": "ok",
  "version": "0.6.1",
  "sessions": { "active": 0 },
  "tmux": { "healthy": true },
  "claude": { "available": true, "version": "1.2.0" }
}
```

---

## Section 2: Session Creation (0:30 - 1:15)

### Narration

> "Let's create a session. I'll send a prompt that asks Claude to install a package -- something that triggers a Bash permission prompt. I'm using permission mode 'default' so every tool call needs explicit approval."

### Action

```bash
curl -s -X POST localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/home/demo/my-project",
    "name": "demo-approval-flow",
    "prompt": "Install the lodash npm package and add it to package.json",
    "permissionMode": "default"
  }' | jq
```

### Response to show

```json
{
  "id": "a1b2c3d4",
  "name": "demo-approval-flow",
  "workDir": "/home/demo/my-project",
  "status": "unknown",
  "permissionMode": "default",
  "createdAt": "2026-04-23T10:00:00.000Z"
}
```

### On screen

- **[S03]** curl command and JSON response in the right pane.
- **[S04]** Left pane: server logs showing session creation, tmux window spawn, Claude Code starting up.
- **[S05]** `ag sessions ls` output showing the new session in the list.

### Narration (after response)

> "The session is live. Claude Code is now running inside a tmux window, processing our prompt. Watch the server logs -- you can see Claude start working. The first thing it will try to do is run `npm install lodash`, which requires Bash permission."

---

## Section 3: Permission Prompt Detected (1:15 - 1:45)

### Narration

> "Here's the key moment. Claude hits a permission prompt because it wants to run a Bash command. Aegis detects this through its hook system -- Claude Code itself tells Aegis it needs permission -- and instantly fires an event to all connected channels."

### On screen

- **[S06]** Server logs: incoming `POST /v1/hooks/PermissionRequest` with `tool_name: "Bash"`.
- **[S07]** Server logs: SSE `approval` event emitted.
- **[S08]** Server logs: notification dispatched to Telegram channel.

### Narration

> "My phone just buzzed. Let me show you."

---

## Section 4: Mobile Approval via Telegram (1:45 - 2:30)

### Action

Switch to phone screen recording (or hold phone to camera).

### On screen (phone)

- **[S09]** Telegram notification banner: "Aegis: Permission required in demo-approval-flow".
- **[S10]** Telegram chat with the Aegis bot showing:
  ```
  ⚠️ Permission prompt — demo-approval-flow

  Claude wants to use: Bash
  Command: npm install lodash

  Reply /approve or /reject
  ```

### Narration

> "I can see exactly what Claude wants to do -- install lodash via npm. I trust this, so I'll approve it."

### Action

Type `/approve` in Telegram (or tap the inline button if configured).

### On screen

- **[S11]** Telegram message sent: `/approve`.
- **[S12]** Bot reply: "Approved in demo-approval-flow".

### Narration

> "Done. The approval traveled from my phone, through Telegram, to Aegis, and back to Claude Code -- in under a second. Let's check the server."

---

## Section 5: Session Continues (2:30 - 3:00)

### Action

Switch back to terminal.

### On screen

- **[S13]** Server logs: `approve` command received from Telegram inbound handler.
- **[S14]** Server logs: pending permission resolved with `allow`, keypress sent to tmux.
- **[S15]** Server logs: Claude Code resumes, fires `PostToolUse` hook, continues working.
- **[S16]** `ag sessions ls` showing session status back to `working`.

### Narration

> "Claude picked up the approval and continued. It installed lodash and is now editing package.json. No further permission prompts needed for this file edit because it's a Write tool and we're in default mode. Let me show you what the session output looks like."

### On screen

- **[S17]** Terminal pane: `curl localhost:9100/v1/sessions/a1b2c3d4/messages | jq '.[0:2]'` showing the assistant's messages including tool use output.

---

## Section 6: Reject Flow (3:00 - 3:30)

### Narration

> "What if I don't approve? Let's create another session with a riskier prompt and show the reject path."

### Action

```bash
curl -s -X POST localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/home/demo/my-project",
    "name": "demo-reject-flow",
    "prompt": "Delete all node_modules directories on this machine",
    "permissionMode": "default"
  }' | jq
```

### On screen

- **[S18]** curl command and response.
- **[S19]** Telegram notification: Claude wants to run `rm -rf /home/demo/my-project/node_modules`.
- **[S20]** User types `/reject` in Telegram.
- **[S21]** Bot reply: "Rejected in demo-reject-flow".
- **[S22]** Server logs: permission denied, Claude receives `deny`, adjusts its approach.

### Narration

> "I rejected the command. Claude Code gets the denial and adapts -- it won't run that command. It might ask for a different approach or wait for further instructions. You stay in control."

---

## Section 7: SSE Stream (Alternative Approval Path) (3:30 - 3:50)

### Narration

> "Telegram is one option. You can also subscribe to the SSE event stream from any device -- a browser tab, a custom app, anything that speaks HTTP."

### Action

```bash
curl -N -H "Authorization: Bearer $AEGIS_API_KEY" \
  localhost:9100/v1/events
```

### On screen

- **[S23]** SSE stream showing live events:
  ```
  event: session_approval
  data: {"sessionId":"a1b2c3d4","prompt":"Bash: npm install lodash"}

  event: session_status_change
  data: {"sessionId":"a1b2c3d4","status":"working"}
  ```

### Narration

> "Events stream in real time. You can approve programmatically via the REST API -- `POST /v1/sessions/:id/approve` -- which is how you'd build custom dashboards or approval UIs."

---

## Section 8: Wrap-Up (3:50 - 4:00)

### Narration

> "That's the mobile approval flow in Aegis. Session starts, Claude works, you get notified on your phone when it needs permission, you approve or reject, and it continues. Works over Telegram, SSE, webhooks, Slack -- any channel you configure. All open source, self-hosted, MIT licensed. Check it out at github.com/onestepat4time/aegis."

### On screen

- **[S24]** Aegis GitHub repo URL.
- **[S25]** `ag sessions ls` showing completed sessions.
- **[S26]** Cleanup: kill demo sessions.

---

## Key Features to Highlight (ad-lib reminders)

- **Hook-based detection**: Near-instant -- Claude Code itself reports permission needs, no polling delay.
- **10-second timeout**: If no one responds within 10 seconds, the permission auto-rejects. Safe by default.
- **Multiple channels**: Telegram is bidirectional; webhooks/Slack are notify-only but you can approve via REST API.
- **Permission modes**: `default` requires approval; `auto` approves everything. Choose per-session.
- **Audit trail**: Every approval/rejection is logged with timestamps.
- **SSE replay**: Missed events are replayed via `Last-Event-ID` header.

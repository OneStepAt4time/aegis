# Demo Screenshots: Mobile Approval Flow

> Capture list for the demo video walkthrough. Each entry maps to a `[S##]`
> placeholder in [DEMO_SCRIPT.md](./DEMO_SCRIPT.md).

## How to Use This List

1. Follow the [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) walkthrough in order.
2. At each `[S##]` marker, capture the described screen.
3. Name files `S##-<short-name>.png` and place them in `docs/demo/screens/`.
4. Update this list with actual filenames once captured.

---

## Section 1: Introduction

| ID | Capture | Description |
|----|---------|-------------|
| S01 | Aegis README header | Browser showing the GitHub repo README with the Aegis banner/logo. |
| S02 | Health check response | Terminal showing `curl localhost:9100/v1/health \| jq` output with `status: "ok"`, version, tmux and Claude health. |

## Section 2: Session Creation

| ID | Capture | Description |
|----|---------|-------------|
| S03 | Create session curl | Terminal showing the `POST /v1/sessions` curl command and the `201` JSON response with session ID, name, and status. |
| S04 | Server logs at creation | Left pane showing server logs: session created, tmux window spawn, Claude Code launch output. |
| S05 | Session list | Output of `ag sessions ls` (or `curl /v1/sessions`) showing the new `demo-approval-flow` session. |

## Section 3: Permission Prompt Detected

| ID | Capture | Description |
|----|---------|-------------|
| S06 | Hook received in logs | Server logs showing `POST /v1/hooks/PermissionRequest` with `tool_name: "Bash"` and `permission_prompt` text. |
| S07 | SSE approval event | Server logs or SSE stream showing `event: session_approval` emitted with prompt details. |
| S08 | Notification dispatched | Server logs showing `Telegram: sending permission notification` or equivalent channel dispatch. |

## Section 4: Mobile Approval via Telegram

| ID | Capture | Description |
|----|---------|-------------|
| S09 | Phone notification banner | Phone lock screen or notification shade showing the Aegis Telegram notification. |
| S10 | Telegram chat — prompt | Telegram app open, showing the bot message with tool name, command, and `/approve` / `/reject` prompt. |
| S11 | Telegram `/approve` sent | Telegram showing the user's `/approve` message. |
| S12 | Bot confirmation | Telegram showing the bot's reply confirming the approval. |

## Section 5: Session Continues

| ID | Capture | Description |
|----|---------|-------------|
| S13 | Approve in server logs | Server logs showing the Telegram inbound `approve` command received. |
| S14 | Permission resolved | Server logs: `resolvePendingPermission` called with `allow`, keypress sent to tmux pane. |
| S15 | Claude resumes | Server logs showing `PostToolUse` hook fired, Claude continuing work. |
| S16 | Session status working | `ag sessions ls` or API response showing session status back to `working`. |
| S17 | Session messages | `curl /v1/sessions/:id/messages \| jq` showing the assistant messages and tool output (lodash installed). |

## Section 6: Reject Flow

| ID | Capture | Description |
|----|---------|-------------|
| S18 | Second session curl | Terminal showing the second `POST /v1/sessions` for the reject demo. |
| S19 | Telegram — risky prompt | Telegram showing the bot message with the `rm -rf` command. |
| S20 | Telegram `/reject` sent | Telegram showing the user's `/reject` message. |
| S21 | Bot rejection confirmation | Telegram showing the bot's reply confirming rejection. |
| S22 | Deny in server logs | Server logs showing permission denied, Claude receiving `deny` decision. |

## Section 7: SSE Stream

| ID | Capture | Description |
|----|---------|-------------|
| S23 | SSE stream output | Terminal showing `curl -N /v1/events` with live SSE events: `session_approval`, `session_status_change`, etc. |

## Section 8: Wrap-Up

| ID | Capture | Description |
|----|---------|-------------|
| S24 | GitHub repo URL | Browser or terminal showing `github.com/onestepat4time/aegis`. |
| S25 | Completed sessions | `ag sessions ls` showing both demo sessions in `ended` or `idle` state. |
| S26 | Cleanup | Terminal showing session deletion commands and clean state. |

---

## Summary

- **Total screenshots**: 26
- **Sections**: 8
- **Primary capture devices**: terminal (20), phone (6)
- **Key moments**: S10 (Telegram prompt) and S11/S20 (approve/reject tap) are the hero shots.

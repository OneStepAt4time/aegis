# Release Notes — v0.7.0 (DRAFT)

**Date:** 2026-05-24  
**Author:** Orpheus 🎤  
**Status:** DRAFT — pending version bump from Hermes

---

## Two sprints, one release.

This release ships two complete feature sprints in a single version bump: **Telegram one-tap session approval** and **zero-config init**. Together, they solve the two biggest friction points for new users: getting started, and staying in control while AFK.

---

## 🆕 Zero-config init

**Sprint:** #4098 — Zero-config init  
**PRs:** #4108, #4105, #4111

`npx @onestepat4time/aegis init` → zero to dashboard in under 60 seconds.

On a fresh machine with Node 22:
1. Scaffolds `.aegis/config.yaml` with safe defaults
2. Auto-detects a free port (9100 default, increments until available)
3. Starts the Aegis server as a detached process
4. Waits for health check (up to 30s timeout)
5. Opens the dashboard in your default browser
6. Prints the URL, config path, and PID

**Flags:**
- `--no-start` — scaffold config only, don't start the server
- `--no-open` — start server but skip opening the browser
- `--force` — overwrite existing config
- `--defaults` — non-interactive, use all defaults

**Re-run handling:** If Aegis is already running, prints the dashboard URL and exits with code 2. No duplicate instances.

---

## 📱 Telegram one-tap session approval

**Sprint:** #4085 — One-tap Telegram session approval  
**PRs:** #4092, #4096, #4091, #4090, #4106

Approve Claude Code sessions from your phone with two taps.

When a session is created, Aegis sends a Telegram notification with inline Approve ✅ / Reject ❌ buttons. Tap approve, the session starts. Tap reject, it's rejected. If you don't respond within the timeout, the session is auto-rejected.

**New features:**
- Session approval state machine: `pending_approval → approved → running` or `rejected`
- Telegram inline keyboard buttons on session creation
- New API endpoints: `POST /v1/sessions/:id/approve` and `POST /v1/sessions/:id/reject`
- Bot callback authentication with secret token verification
- Configurable `sessionApproval` section with timeout auto-reject
- Dashboard status indicators for pending approval sessions
- Telegram notification settings page in the dashboard

**Setup:**

Set two env vars and restart Aegis:

```bash
export AEGIS_TG_BOT_TOKEN="<your-bot-token>"
export AEGIS_TG_GROUP="<your-chat-id>"   # positive for DM, negative for group
```

Or add to `aegis.config.json`:

```json
{ "tgBotToken": "<token>", "tgGroupId": "<chat-id>" }
```

See [`docs/guides/phone-approvals.md`](https://github.com/OneStepAt4time/aegis/blob/develop/docs/guides/phone-approvals.md) for the full walkthrough (creating a bot, getting the chat ID, security notes).

---

## 🎨 Dashboard improvements

**PRs:** #4112, #4107, #4109, #4103, #4097

- **Server connection health indicator** — live status of Aegis server connection in the dashboard
- **First-run welcome screen** — guided onboarding for new users (#4105)
- **Focus traps on 5 modal dialogs** — keyboard accessibility improvement (#4107)
- **Placeholder text contrast** — meets WCAG AA standards (#4097)
- **Pending approval CSS variable and i18n keys** — foundation for approval UI (#4093)
- **OverviewPage landmark test fix** — a11y test passing with WelcomeScreen (#4109)

---

## 📚 Documentation

**PRs:** #4111, #4106, #4104, #4090

- **Phone approvals setup guide** — step-by-step Telegram approval setup (#4090)
- **Session-level approval gate docs** — architecture and configuration reference (#4106)
- **Zero-config init docs** — `ag init` usage and flags (#4111)
- **README one-liner above the fold** — `npx @onestepat4time/aegis init` visible in hero section (#4104)

---

## 🔧 What's next

- **Session recovery** — pick up sessions after connection drops
- **Approval policies** — auto-approve reads, always require approval for destructive commands
- **More approval channels** — Slack and Discord inline approval buttons

---

## Contributors

- OneStepAt4time (all PRs)

---

## Upgrade

```bash
npm install -g @onestepat4time/aegis@latest
# or
npx --package=@onestepat4time/aegis ag init
```

---

*Full changelog: see commit history on `main` branch.*

# Phone Approvals — One-Tap Session Control from Telegram

**Approve or reject Claude Code permission prompts from your phone, in under 5 minutes.**

When Claude Code needs permission — to run a command, write a file, or access a resource — Aegis sends a notification to your Telegram with inline buttons. One tap to approve, one tap to reject. No SSH, no dashboard, no laptop required.

---

## Prerequisites

- [Aegis server running](../five-minute-setup.md) (localhost or remote)
- A [Telegram](https://telegram.org/) account
- 5 minutes

---

## Step 1: Create a Telegram Bot (2 minutes)

### 1.1 Open BotFather

Open Telegram and search for **[@BotFather](https://t.me/BotFather)**. Send `/newbot`.

### 1.2 Choose a name and username

BotFather asks for:
- **Bot display name** — anything you like, e.g. `My Aegis Bot`
- **Bot username** — must end in `bot`, e.g. `my_aegis_approvals_bot`

### 1.3 Copy the bot token

BotFather responds with:

```
Done! Congratulations on your new bot...
Use this token to access the HTTP API:
7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Copy the **bot token** (the long string after `HTTP API:`). You'll need it in Step 3.

> ⚠️ **Keep this token secret.** Anyone with it can control your bot. Treat it like a password. Never commit it to git or share it publicly.

---

## Step 2: Get Your Chat ID (1 minute)

### Option A: Private chat (recommended for solo use)

1. Send any message to your new bot in a private chat
2. Open this URL in your browser (replace `YOUR_BOT_TOKEN`):

```
https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
```

3. Find the `"chat"` object in the JSON response. Your chat ID is `"chat":{"id": 123456789}`

> The chat ID is a number. For private chats, it's positive (e.g. `123456789`). For groups, it's negative (e.g. `-1001234567890`).

### Option B: Group chat (for teams)

1. Create a Telegram group (or use an existing one)
2. Add your bot to the group: open group info → Add Members → search for your bot's username
3. **Make the bot an admin**: group info → Administrators → select your bot → enable
4. Send a message in the group (any message)
5. Open `https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates`
6. Find `"chat":{"id": -1001234567890}` — the negative number is your group chat ID

> **Why admin?** Bots in groups need admin rights to see messages and create topics.

---

## Step 3: Configure Aegis (1 minute)

### Via environment variables

Set these environment variables where Aegis runs:

```bash
export AEGIS_TG_BOT_TOKEN="7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
export AEGIS_TG_GROUP_ID="-1001234567890"   # your chat ID from Step 2
```

Then restart Aegis:

```bash
# If running via CLI
ag run "..." --cwd ./my-project

# If running as a service
openclaw gateway restart
```

### Via config file

Or add to your `aegis.config.json`:

```json
{
  "tgBotToken": "7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "tgGroupId": "-1001234567890"
}
```

### Verify it works

1. Start a session: `ag run "List files" --cwd ./my-project`
2. Check Telegram — you should see a session creation notification
3. When Claude needs permission, you'll get an inline button prompt

---

## Step 4: Approve from Your Phone

When Claude Code needs your approval, you'll see a notification like:

```
⚠️ Permission: Allow executing: ls -la /home/user/project

[ ✅ Approve ]  [ ❌ Reject ]
```

Tap **✅ Approve** to allow, or **❌ Reject** to deny. That's it.

### What you can approve from Telegram

| Prompt type | Notification | Buttons |
|------------|-------------|---------|
| **Permission** (tool use) | `⚠️ Permission: ...` | Approve / Reject (or dynamic options) |
| **Question** | `❓ Question text` | Yes / No / Skip |
| **Plan** | `📋 Plan summary` | Execute / Execute All / Cancel |

After you tap a button, the inline buttons disappear — no double-tap accidents.

---

## Optional Configuration

### Restrict who can approve

Limit approvals to specific Telegram users:

```bash
export AEGIS_TG_ALLOWED_USERS="123456789,987654321"
```

Only these Telegram user IDs can tap buttons. Everyone else gets "⛔ You are not authorized."

> To find a user's Telegram ID, have them message `@userinfobot` on Telegram.

### Verbose mode (full output forwarding)

By default, Telegram shows compact messages (tool summaries, no raw output). Enable verbose mode to see everything Claude does:

```bash
export AEGIS_TG_VERBOSE=true
```

Or in config:

```json
{
  "tgVerbose": true
}
```

### Using topics (group chats only)

In group chats, Aegis creates a separate topic per session. Each session's messages, approvals, and status updates stay in their own thread — no clutter.

Topics are automatically created and cleaned up. No configuration needed.

---

## Security Best Practices

1. **Keep your bot token secret** — never commit it to git, post it in chat, or share it publicly. Use environment variables, not hardcoded strings.
2. **Use a private chat for solo use** — group chats expose your bot token's activity to all members.
3. **Set `AEGIS_TG_ALLOWED_USERS`** — even in private chats, this prevents unauthorized use if your bot token leaks.
4. **Use HTTPS in production** — if Aegis runs remotely, ensure the server uses TLS. Telegram sends approval tokens over your bot's HTTPS connection, but your Aegis server should also be secured.
5. **Rotate tokens on suspicion** — if you think your bot token leaked, use BotFather's `/revoke` command immediately, then update your config.
6. **Don't auto-approve everything** — the `-y` flag exists, but defeats the purpose of phone approvals. Review what you're approving.

---

## Troubleshooting

### Bot doesn't respond / no notifications

- **Check the token:** Open `https://api.telegram.org/botYOUR_BOT_TOKEN/getMe` in your browser. You should see `"ok":true` and your bot's name. If not, the token is wrong.
- **Check Aegis logs:** Look for `Telegram:` entries in the server output. Common errors:
  - `401 Unauthorized` — wrong bot token
  - `400 Bad Request: chat not found` — wrong chat ID
  - `409 Conflict` — another bot instance is running (BotFather gives one poll connection per token)
- **Did you message the bot first?** Bots can't initiate private chats. Send any message to your bot before starting Aegis.

### Buttons don't work / nothing happens on tap

- **Check `AEGIS_TG_ALLOWED_USERS`:** if set, your Telegram user ID must be in the list. Message `@userinfobot` to find your ID.
- **Session already ended:** if the session completed or was killed, the buttons are stale. Check `ag list` to see active sessions.
- **Bot not admin in group:** for group chats, the bot must be an administrator to receive callback queries.

### Wrong chat ID

- **Positive vs negative:** private chat IDs are positive (`123456789`), group IDs are negative (`-1001234567890`). If notifications don't arrive, you likely mixed these up.
- **Supergroup vs regular group:** all groups created in recent Telegram versions are supergroups (negative ID starting with `-100`). Older groups have shorter negative IDs. If in doubt, use `getUpdates` to get the exact ID.

### Messages appear but are unreadable / garbled

- This is usually a formatting issue with verbose mode. Try disabling `AEGIS_TG_VERBOSE` and using compact mode (the default).

### Multiple bots / multiple instances

- One bot token = one Aegis instance. If you run multiple Aegis servers, create a separate bot for each via BotFather.
- If you see `409 Conflict` in logs, another process is polling the same bot token. Kill it or use a different token.

---

## How It Works (Architecture)

```
Claude Code session → Aegis server → Telegram Bot API → Your phone
                        ↑                                    |
                        └── approve/reject ←─────────────────┘
```

1. **Claude Code** hits a permission prompt
2. **Aegis** sends a Telegram message with inline buttons to your chat
3. You tap **Approve** or **Reject** on your phone
4. **Telegram** sends the callback to Aegis via the Bot API
5. **Aegis** routes the approval back to the Claude Code session
6. Claude continues (or stops if rejected)

End-to-end latency: typically under 2 seconds.

---

## What's Next

- [Notification Channels](../integrations/notifications.md) — Slack, email, webhooks
- [Dashboard](../dashboard.md) — visual session management
- [API Reference](../api-reference.md) — approve/reject via REST API
- [Security Best Practices](../security-best-practices.md) — production hardening

---

## Dashboard Configuration

> 🚧 **Coming soon** — Daedalus is building a Telegram settings page in the Aegis dashboard. Once available, you'll be able to configure your bot token, chat ID, and approval settings from the browser without editing config files or environment variables.

---

*Questions? [Open an issue](https://github.com/OneStepAt4time/aegis/issues/new) or ask in [Discord](https://discord.com/invite/clawd).*

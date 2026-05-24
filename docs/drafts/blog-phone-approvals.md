# Two Clicks to Approve Claude Code from Your Phone

You're at lunch. Your agent hits a permission wall — it wants to run a destructive command. Your terminal is waiting. Your deploy is blocked.

This used to mean: stop what you're doing, open the laptop, find the terminal, scroll up, approve, go back to lunch.

Not anymore.

## What shipped

Aegis now supports **one-tap session approval from Telegram**. When your Claude Code agent needs permission, you get a Telegram notification with inline Approve ✅ / Reject ❌ buttons. Two clicks. Done. You never open a terminal.

Here's what it looks like:

1. You kick off a session from the CLI:
   ```bash
   ag run "Refactor the auth module and run the test suite" --cwd ./my-project
   ```

2. Aegis creates the session and sends a Telegram notification:

   > 🔔 **New session requires approval**
   > `refactor-auth-module`
   > Claude Code wants to run in `./my-project`
   > [✅ Approve] [❌ Reject]

3. You tap Approve on your phone. The session starts. You get a second notification when it's done.

That's it. No laptop. No terminal. No context switch.

## Why this matters

AI coding agents are only useful if you can trust them enough to let them run — but not so much that you stop watching. The hardest part isn't the agent's intelligence. It's the **human in the loop**.

Every minute your agent spends waiting for you to approve something is a minute of compute wasted and momentum lost. Phone approvals turn "monitor an agent" from a desk job into a background task.

## Set it up in 60 seconds

```bash
# 1. Create a Telegram bot via @BotFather (takes 30 seconds)
# 2. Create a group, add the bot, get the chat ID
# 3. Run setup
ag setup telegram
```

That's it. Aegis handles the rest — notifications, inline buttons, callback authentication, timeout auto-reject if you don't respond.

## What's next

- **Session recovery** — if your connection drops, pick up exactly where you left off
- **Approval policies** — auto-approve reads, always require approval for deletes
- **More channels** — Slack and Discord approvals coming soon

## Try it now

```bash
npx --package=@onestepat4time/aegis ag init
ag setup telegram
ag run "Build a REST API for a todo app" --cwd ./my-project
```

Approve from your phone. Ship from anywhere.

---

*Aegis is open-source (MIT), self-hosted, and works with Claude Code out of the box. [Star us on GitHub](https://github.com/OneStepAt4time/aegis) or [join the community](https://discord.com/invite/clawd).*

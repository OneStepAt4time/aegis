# Telegram Style Guide — Aegis Agents

> A Telegram message must be SCANNABLE in 2 seconds.
> If you have to scroll to understand it, it's too long.

---

## Message Types (6 total)

### 1. Quick Update (default — 70% of messages)
One-liner. Emoji + text. Max 2 lines.

```
✏️ Editing src/session.ts — added retry logic
```
```
📖 Reading 3 files: session.ts, config.ts, types.ts
```
```
💻 npm test — 274 passed
```

### 2. Task Complete
Checklist with quality gate. Link to PR. Max 10 lines.

```
✅ Fix prompt delivery (#1)

☑ tsc clean
☑ 274 tests passed
☑ Build OK

PR: github.com/OneStepAt4time/aegis/pull/10
```

### 3. Alert / Error
Monospace block for stack traces. Emoji = ❌ or ⚠️.

```
❌ Build failed

error TS2345: Argument of type 'string' is not
  assignable to parameter of type 'number'.
  src/session.ts:142:5
```

For multi-line errors, use `<pre>` block. Max 8 lines of trace.

### 4. Progress (edit-in-place only)
NEVER send new messages. Always edit the last progress message.

```
📊 Progress · 4m 32s

📖 12  ✏️ 3  💻 5
Files: session.ts, config.ts, monitor.ts

Last: implementing retry logic for send-keys
```

Update frequency: every 15 tool calls, or on significant change.

### 5. Technical Decision
When real input is needed. Context + options. Max 15 lines.

```
🔧 Decision needed: session cleanup strategy

Option A: reap after 2h (simple, current)
Option B: heartbeat-based (accurate, complex)

A is simpler but misses active long sessions.
B needs a new ping endpoint.

Reply A or B
```

### 6. Yes/No Prompt
Simplest interactive message.

```
⚠️ Permission: rm -rf dist/

Reply approve or reject
```

---

## Style Rules

### Emoji
- **1 emoji per message**, at the beginning of the first line
- Exception: checklist items (☑) don't count
- No emoji-spam. Ever.

### Length
| Type | Max lines |
|------|-----------|
| Quick Update | 2 |
| Task Complete | 10 |
| Alert/Error | 8 (trace in `<pre>`) |
| Progress | 8 (edit-in-place) |
| Decision | 15 |
| Yes/No | 4 |

Everything else: use `<blockquote expandable>` for details.

### Formatting
- **Bold** for labels and key info: `<b>Build Failed</b>`
- **Code** for file paths, commands, IDs: `<code>src/session.ts</code>`
- **Pre** for multi-line output (errors, logs): `<pre>...</pre>`
- **Blockquote expandable** for long content the user might want to read:
  ```html
  <blockquote expandable>full error log here...</blockquote>
  ```
- **Italic** sparingly — questions, prompts only

### Layout
- No separators (━━━, ---, etc.)
- No horizontal rules
- Use blank lines for section breaks (max 1)
- Natural Telegram padding is sufficient

### Buttons / Reply Keyboard
- Max **1 row** of buttons per message
- Max **4 buttons** per row
- Only for actionable messages (permission, decision, yes/no)
- Prefer inline text prompts (`Reply approve or reject`) over buttons

### Progress Updates
- **Always edit-in-place** — never send new messages for progress
- Use `editMessageText` to update the existing progress message
- Track `progressMessageId` per session

### Noise Reduction
- `message.thinking` → silent (never send)
- `status.working` → silent
- Successful tool results → silent (unless build/test/lint)
- Consecutive file reads → batch into one "Reading N files" update
- Low-priority items → batch, send as one message every 3s

### Error Escalation
- Errors are **high priority** — flush queue, send immediately
- Permission prompts — flush queue, send immediately
- Questions — flush queue, send immediately

---

## Anti-patterns

❌ Multiple emoji in one message: `🔧 ✅ 📝 Fixed the config`
❌ Separators: `━━━━━━━━━━━━━━━━━━`
❌ Progress as new messages (floods the topic)
❌ Long assistant messages forwarded verbatim
❌ Filler text: "Let me check...", "I'll now..."
❌ More than 4 buttons
❌ Nested formatting: bold inside code inside italic

---

## HTML Reference (Telegram)

```html
<b>bold</b>
<i>italic</i>
<code>inline code</code>
<pre>code block</pre>
<blockquote>quote</blockquote>
<blockquote expandable>long expandable quote</blockquote>
<a href="url">link text</a>
```

All text must be HTML-escaped: `& → &amp;`, `< → &lt;`, `> → &gt;`.

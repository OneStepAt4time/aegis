# Inbox — Structured Notification Feed

The Inbox shows a scannable feed of agent activity. Items appear in real-time as sessions complete, fail, need approval, or stall.

## What's Live

The dashboard inbox page is available now. It works by bridging existing SSE events — no additional backend setup needed.

## How It Works

The inbox listens to the same SSE activity stream the dashboard already uses. When relevant events fire, they appear as inbox items:

| SSE Event | Inbox Type | Icon | Description |
|-----------|-----------|------|-------------|
| `session_ended` | `task_completed` | ✅ | Session finished successfully |
| `session_dead` | `task_failed` | ❌ | Session crashed or errored |
| `session_approval` | `blocker` | ⚠️ | Session awaiting user approval |
| `session_stall` | `session_idle` | 🌙 | Session stalled or idle |

## Using the Inbox

**Navigation:** Click **Inbox** in the sidebar. An unread badge shows the count of unread items.

**Actions:**
- **Mark as read** — click the check icon on an item, or use "Mark all read"
- **Archive** — click the archive icon to hide an item from the default view
- **Navigate to session** — click any item to jump to the referenced session

**Filters:** Switch between All / Unread / Archived views.

## Real-Time Updates

New items appear automatically — no page refresh needed. The inbox hooks into the existing SSE connection:

1. Dashboard subscribes to global SSE events
2. `useInboxFromActivity` bridge converts relevant events to inbox items
3. Items are deduplicated and prepended to the feed
4. Unread badge updates instantly

## i18n

The inbox supports English and Italian. Language follows the dashboard's locale setting.

## What's Not Live Yet

The REST API for inbox CRUD (`GET /v1/inbox`, mark read, archive) is pending backend implementation. Currently, inbox items are derived from the SSE activity stream in real-time — they are not persisted across page refreshes until the backend ships.

Once the backend routes land, the inbox will gain:
- Persisted items across sessions
- Full CRUD API (`GET /v1/inbox`, `POST /v1/inbox/:id/read`, `POST /v1/inbox/:id/archive`, etc.)
- Unread count in API response headers
- Batch operations (mark all read, archive all read)

## Architecture

```
SSE Stream → Activity Store → useInboxFromActivity hook → Inbox Store → InboxPage
                                     (bridge)                (state)      (UI)
```

The key insight: inbox items are derived from events, not stored separately. This means zero backend dependencies for the initial implementation. When persistence is needed, the same store gains an API fetch on mount.

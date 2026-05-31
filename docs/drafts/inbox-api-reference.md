<!--
  INBOX API REFERENCE — STUB
  Issue: #3985 (Inbox — Structured Notification Feed)
  Status: DRAFT — pending implementation
  
  Will be merged into docs/api-reference.md as Section 15: Inbox
-->

# Inbox API

The Inbox provides a structured feed of agent activity. Items are created automatically from session lifecycle events and delivered in real-time via SSE.

**Base path:** `/v1/inbox`

## Inbox Item Types

| Type | Trigger | Description |
|------|---------|-------------|
| `session_completed` | Session finishes successfully | Agent completed its task |
| `session_failed` | Session crashes or errors | Agent hit an error |
| `session_needs_approval` | Session requests permission | Agent needs user approval to continue |

> Future types (blocked on other features): `task_completed`, `task_failed`, `blocker`, `mention`

## Endpoints

### List Inbox Items

```
GET /v1/inbox
```

Returns inbox items sorted by `created_at` descending. Archived items excluded by default.

**Parameters:**

| Parameter | Type | In | Description |
|-----------|------|----|-------------|
| `limit` | integer | query | Max results (default 50) |
| `offset` | integer | query | Pagination offset |
| `type` | string | query | Filter by item type |
| `unreadOnly` | boolean | query | Only unread items (default: false) |
| `includeArchived` | boolean | query | Include archived items (default: false) |

**Response:** `200 OK`

```json
{
  "items": [
    {
      "id": "inbox_abc123",
      "type": "session_completed",
      "title": "Session completed: Fix auth tests",
      "body": "All 12 tests passing. Modified 3 files in src/auth/.",
      "actorType": "agent",
      "actorId": "agent_def456",
      "actorName": "backend-dev",
      "referenceType": "session",
      "referenceId": "sess_ghi789",
      "read": false,
      "archived": false,
      "createdAt": "2026-06-01T14:30:00Z"
    }
  ],
  "unreadCount": 3,
  "pagination": {
    "total": 42,
    "limit": 50,
    "offset": 0
  }
}
```

---

### Mark Item as Read

```
POST /v1/inbox/:id/read
```

**Response:** `200 OK`

```json
{
  "id": "inbox_abc123",
  "read": true,
  "readAt": "2026-06-01T14:35:00Z"
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `INBOX_ITEM_NOT_FOUND` | Item ID does not exist |

---

### Mark All as Read

```
POST /v1/inbox/read-all
```

Marks all unread items as read.

**Response:** `200 OK`

```json
{
  "markedRead": 5
}
```

---

### Archive Item

```
POST /v1/inbox/:id/archive
```

Archived items are hidden from the default view.

**Response:** `200 OK`

```json
{
  "id": "inbox_abc123",
  "archived": true,
  "archivedAt": "2026-06-01T14:40:00Z"
}
```

---

### Archive All Read

```
POST /v1/inbox/archive-all
```

Archives all items that have been read.

**Response:** `200 OK`

```json
{
  "archived": 12
}
```

---

## SSE Events

New inbox items are pushed in real-time via the existing SSE connection:

```
event: inbox:item
data: {
  "id": "inbox_abc123",
  "type": "session_completed",
  "title": "Session completed: Fix auth tests",
  "referenceType": "session",
  "referenceId": "sess_ghi789",
  "createdAt": "2026-06-01T14:30:00Z"
}
```

| SSE Event | Payload | Description |
|-----------|---------|-------------|
| `inbox:item` | Full inbox item | New item created |
| `inbox:read` | `{ id }` | Item marked as read (from another client) |
| `inbox:unread_count` | `{ count }` | Unread count changed |

## Dashboard Integration

- **Navigation badge:** unread count shown in sidebar
- **Inbox drawer:** slides in from right with item list
- **Click item:** navigates to referenced session
- **Real-time:** new items appear via SSE without refresh

---

<!--
  TODO: Add when implementation ships
  - RBAC role table (who can see whose inbox items)
  - Rate limits
  - Webhook integration for inbox items
  - Smart grouping / deduplication
  - Examples with curl + TypeScript SDK
-->

# Aegis Dashboard Guide

The Aegis dashboard (`/dashboard/`) provides a web UI for managing sessions, pipelines, and monitoring system health.

## Features

### Theme Toggle (Dark/Light)

Switch between dark and light theme. The dashboard defaults to your system preference (`prefers-color-scheme`) and persists your choice in localStorage.

- **Toggle button** in the header — Sun (light) / Moon (dark) icons
- **System detection** — follows OS/browser dark mode setting by default
- **Manual override** — click to switch, choice saved across sessions
- **40+ CSS variables** adapt for each theme

### Internationalization (i18n)

The dashboard supports multiple languages. Users can switch languages from the header.

- **Supported languages:** English (default), Italian
- **Language switcher** in the header — select your preferred language
- **Persistence** — choice saved in `localStorage` across sessions
- **5 pages localized** (batch 1): NotFound, Activity, Login, Overview, Sessions
- **Catalog** — `dashboard/src/i18n/` contains translation files per language

### Keyboard Shortcuts

Navigate faster using keyboard shortcuts:

| Shortcut | Action |
|----------|-------|
| `?` / `Ctrl+/` / `⌘/` | Toggle help modal |
| `Ctrl+K` / `⌘K` | Toggle keyboard shortcuts help |
| `Ctrl+N` / `⌘N` | New session |
| `G` then `O` | Go to Overview |
| `G` then `S` | Go to Sessions |
| `G` then `P` | Go to Pipelines |
| `G` then `A` | Go to Audit |
| `G` then `U` | Go to Users |
| `Escape` | Close modal |

Mac users: all shortcuts support `⌘` (Cmd) as an alternative to `Ctrl`.

The shortcut hint appears in the sidebar footer. See the [Getting Started guide](./getting-started.md#3-dashboard-keyboard-shortcuts) for the full reference.

### Session History with Search & Filter

The Sessions page (`/dashboard/sessions`) supports real-time search and filtering:

- **Search by name** — filter sessions by name or ID
- **Date range filters** — `Today`, `Last 7 days`, `Last 30 days`, or custom range
- **Sort options** — sort by date, name, or status
- **Health indicators** — status dots animate to show session health:
  - 🟢 **Green** — session running normally
  - 🟡 **Amber (slow pulse)** — session stalled (no activity detected)
  - 🔴 **Red (fast pulse)** — session dead (terminated or unresponsive)

### CSV Export

Export filtered session records as CSV from the Sessions page:

1. Apply your filters (date range, search)
2. Click the **Export CSV** button
3. The browser downloads `sessions-export-{timestamp}.csv`

The CSV includes all visible columns: ID, name, status, created date, and last activity.

### Metric Cards with Sparklines

The Overview page displays key metrics with mini sparkline charts:

- **Active sessions** count
- **Token usage** trends
- **Session duration** averages

Sparklines show the last 7 data points for quick trend visibility.

### Consistent Empty States

All dashboard pages now show consistent empty states when no data is available:

- Sessions page: "No sessions found" with helpful guidance
- Pipelines page: "No pipelines yet" with setup instructions
- Consistent styling across all pages

### Toast Notifications

Feedback for user actions appears as non-blocking toast notifications:

- **Type icons** — success (checkmark), error (X), warning, info — instantly recognizable
- **Auto-dismiss progress bar** — visual countdown shows when toast will disappear
- **Clear all button** — dismiss all toasts at once
- **Variants** — color-coded by severity (green/red/yellow/blue)
- **Accessible** — uses `role="alert"` for screen readers

Toasts auto-dismiss after 4 seconds. Click the X to dismiss manually.

### Breadcrumb Navigation

Breadcrumbs appear at the top of detail pages showing the navigation hierarchy:

- **Format:** `Overview > Sessions > {session-name}`
- **Clickable links** — each segment links back to that level
- **Current page** — shown as plain text (not a link)
- **Overflow handling** — long session names truncate with ellipsis

Example: `Dashboard > Sessions > fix-1786-shell-true`

The session detail page (`/dashboard/sessions/:id`) includes tabbed views:

- **Stream tab** — live terminal output and session interaction
- **Transcript tab** — full chronological message history with:
  - Syntax-highlighted code blocks
  - Expand/collapse for long messages (100-char truncation)
  - Toggle to show/hide thinking messages
- **Audit tab** — permission prompts, approvals, and rejections:
  - 🟢 Green — permission granted / approved
  - 🔴 Red — permission denied / rejected
  - 🟡 Amber — permission prompt / request
- **Metrics tab** — token usage, latency, and session statistics

Navigation:
- **Breadcrumb** — `Dashboard > Sessions > {session-name}`
- **Copy session ID** — one-click to clipboard
- **Back to sessions** — quick navigation link
- **Status badges** — visual status indicators
- **Action buttons** — interrupt, terminate, fork, save as template

## Pages

### Overview (`/dashboard/overview`)
System health, active sessions count, and metric sparklines.

### Sessions (`/dashboard/sessions`)
List of all sessions with search, filter, date range, and CSV export.

### New Session (`/dashboard/sessions/new`)
Create a new Aegis session directly from the dashboard without using the API.

**Template selector:** Click a template card to pre-fill the session fields (name, work directory, prompt, Claude command, and permission mode). Templates are loaded from the Templates page.

**Manual fields:**
- **Name** — optional session name
- **Prompt** — initial task description for Claude Code
- **Work Directory** — directory where Claude Code will run
- **Permission Mode** — default, bypassPermissions, plan, acceptEdits, dontAsk, or auto

After creation, the session opens in the detail view.

### Pipelines (`/dashboard/pipelines`)
Pipeline management and monitoring.

### Templates (`/dashboard/templates`)
Manage reusable session templates.

- **Create** — define template with name, prompt, work directory, Claude command, and permission mode
- **Edit** — modify existing template fields
- **Duplicate** — copy a template with all fields (suffixed with '(copy)')
- **Delete** — remove with confirmation dialog

Templates can be selected when creating a new session (see above).

### Audit (`/dashboard/audit`)
Audit log viewer for compliance and debugging.

### Users (`/dashboard/users`)
User management (enterprise deployments).

## Authentication

The dashboard requires authentication. Set `AEGIS_AUTH_TOKEN` before starting Aegis, then log in with your token. See [Getting Started](./getting-started.md#1-start-with-authentication).

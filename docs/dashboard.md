# Aegis Dashboard Guide

The Aegis dashboard (`/dashboard/`) provides a web UI for managing sessions, pipelines, and monitoring system health.

## Features

### Keyboard Shortcuts

Navigate faster using keyboard shortcuts:

| Shortcut | Action |
|----------|-------|
| `?` | Toggle help modal |
| `Ctrl+K` | Toggle keyboard shortcuts help |
| `G` then `O` | Go to Overview |
| `G` then `S` | Go to Sessions |
| `G` then `P` | Go to Pipelines |
| `G` then `A` | Go to Audit |
| `G` then `U` | Go to Users |
| `Escape` | Close modal |

The shortcut hint appears in the sidebar footer. See the [Getting Started guide](./getting-started.md#3-dashboard-keyboard-shortcuts) for the full reference.

### Session History with Search & Filter

The Sessions page (`/dashboard/sessions`) supports real-time search and filtering:

- **Search by name** — filter sessions by name or ID
- **Date range filters** — `Today`, `Last 7 days`, `Last 30 days`, or custom range
- **Sort options** — sort by date, name, or status

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

## Pages

### Overview (`/dashboard/overview`)
System health, active sessions count, and metric sparklines.

### Sessions (`/dashboard/sessions`)
List of all sessions with search, filter, date range, and CSV export.

### Pipelines (`/dashboard/pipelines`)
Pipeline management and monitoring.

### Audit (`/dashboard/audit`)
Audit log viewer for compliance and debugging.

### Users (`/dashboard/users`)
User management (enterprise deployments).

## Authentication

The dashboard requires authentication. Set `AEGIS_AUTH_TOKEN` before starting Aegis, then log in with your token. See [Getting Started](./getting-started.md#1-start-with-authentication).

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
- **13 pages localized:** NotFound, Activity, Login, Overview, Sessions, Analytics, Audit, Cost, Metrics, Auth Keys, Settings, Templates
- **Catalog** — `dashboard/src/i18n/` contains translation files per language (`en.ts`, `it.ts`)

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
- **Windows-aware paths** — work directories are normalized across `/` and `\`, `C:\Users\<name>\` paths abbreviate to `C:/…/`, and long names truncate in the cell instead of overflowing the list.

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
  - Long Actor, Action, and Session ID values truncate with a hover title so the audit table remains readable on narrow screens.
- **Metrics tab** — token usage, latency, and session statistics

Navigation:
- **Breadcrumb** — `Dashboard > Sessions > {session-name}`
- **Copy session ID** — one-click to clipboard
- **Back to sessions** — quick navigation link
- **Status badges** — visual status indicators
- **Action buttons** — interrupt, terminate, fork, save as template

## Sidebar Navigation

The dashboard sidebar is organized into three groups:

| Group | Page | Path | Description |
|-------|------|------|-------------|
| **WORKSPACE** | Overview | `/` | System health, active sessions, metric sparklines |
| | Sessions | `/sessions` | All sessions with search, filter, CSV export |
| | Templates | `/templates` | Reusable session templates |
| | Pipelines | `/pipelines` | Pipeline management and monitoring |
| **OPERATIONS** | Audit | `/audit` | Audit log viewer for compliance and debugging |
| | Metrics | `/metrics` | Performance and latency metrics |
| | Cost | `/cost` | Token usage and cost tracking |
| | Analytics | `/analytics` | Usage analytics and trends |
| **ADMIN** | Auth Keys | `/auth/keys` | API key management |
| *(bottom)* | Settings | `/settings` | Server and dashboard configuration |

The sidebar supports collapse/expand toggle and a mobile-responsive drawer for narrow viewports.

## Pages

### Overview (`/dashboard/` or `/dashboard/overview`)
System health, active sessions count, and metric sparklines.

### Sessions (`/dashboard/sessions`)
List of all sessions with search, filter, date range, and CSV export.

### New Session (`/dashboard/sessions/new`)
Create a new Aegis session directly from the dashboard without using the API.

**Template selector:** Click a template card to pre-fill the session fields (name, work directory, prompt, Claude command, and permission mode). Templates are loaded from the Templates page.

The first-run guided tour pauses while the New Session drawer is open, preventing drawer backdrops from blocking tour controls.

**Manual fields:**
- **Name** — optional session name
- **Prompt** — initial task description for Claude Code
- **Work Directory** — directory where Claude Code will run
- **Permission Mode** — default, bypassPermissions, plan, acceptEdits, dontAsk, or auto

After creation, the session opens in the detail view.

### Templates (`/dashboard/templates`)
Manage reusable session templates.

- **Create** — define template with name, prompt, work directory, Claude command, and permission mode
- **Edit** — modify existing template fields
- **Duplicate** — copy a template with all fields (suffixed with '(copy)')
- **Delete** — remove with confirmation dialog

Templates can be selected when creating a new session (see above).

### Pipelines (`/dashboard/pipelines`)
Pipeline management and monitoring. Click a pipeline to view its detail page (`/dashboard/pipelines/:id`).

### Audit (`/dashboard/audit`)
Audit log viewer for compliance and debugging. Includes a live audit stream for real-time event monitoring.

### Metrics (`/dashboard/metrics`)
Performance and latency metrics for active and historical sessions.

### Cost (`/dashboard/cost`)
Token usage and cost tracking across sessions.

### Analytics (`/dashboard/analytics`)
Usage analytics and trends, including session activity and token consumption charts.

### Auth Keys (`/dashboard/auth/keys`)
API key management — view, create, and revoke keys. Role and permission information displayed per key.

### Settings (`/dashboard/settings`)
Server and dashboard configuration.

### Users (`/dashboard/users`)
User management (enterprise deployments).

## Authentication

The dashboard supports two authentication methods:

1. **API Token** — set `AEGIS_AUTH_TOKEN` before starting Aegis, then log in with your token. See [Getting Started](./getting-started.md#1-start-with-authentication).
2. **OIDC SSO** — enterprise single sign-on via any OpenID Connect provider (Entra ID, Okta, Keycloak, etc.). When configured, the dashboard redirects to your IdP for authentication.

### OIDC SSO Configuration

Dashboard OIDC uses the **authorization-code flow with PKCE**. Set these environment variables before starting Aegis:

| Variable | Required | Description |
|----------|----------|-------------|
| `AEGIS_OIDC_ISSUER` | Yes | IdP issuer URL (e.g. `https://login.microsoftonline.com/tenant-id/v2.0`). Must serve a valid `.well-known/openid-configuration` document. |
| `AEGIS_OIDC_CLIENT_ID` | Yes | OAuth2 client ID registered with your IdP (confidential client for dashboard SSO). |
| `AEGIS_OIDC_CLIENT_SECRET` | Yes (SSO) | Client secret for the confidential dashboard client. Required for dashboard SSO; not needed for CLI device flow alone. |
| `AEGIS_OIDC_REDIRECT_PATH` | No | Callback path registered with the IdP. Defaults to `/auth/callback`. |
| `AEGIS_OIDC_SCOPES` | No | Space-separated scopes requested from the IdP. Defaults to `openid profile email`. |
| `AEGIS_OIDC_AUDIENCE` | No | Expected token audience. Defaults to `AEGIS_OIDC_CLIENT_ID`. |
| `AEGIS_OIDC_ROLE_CLAIM` | No | JWT claim name used for role mapping. Defaults to `aegis_role`. |

**Example IdP registration:**

```
Redirect URI:  https://your-aegis-host/auth/callback
Allowed grant types:  Authorization Code
PKCE:          Enabled (S256)
```

### Auth Flow

1. User visits `/dashboard/` → redirected to `/auth/login`
2. Aegis redirects to the IdP authorization endpoint with PKCE challenge
3. User authenticates at the IdP
4. IdP redirects back to `/auth/callback` with authorization code
5. Aegis exchanges the code for tokens, validates the ID token, and creates an HttpOnly session cookie
6. User lands on `/dashboard/` authenticated

**Security details:**

- Session cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`
- OIDC state parameter is validated (prevents CSRF)
- Nonce validation on ID tokens (prevents replay attacks)
- Dashboard sessions are server-side and expire automatically
- If OIDC is not configured, the dashboard falls back to API token authentication

### Auth Endpoints

These endpoints are registered automatically when OIDC is configured:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/login` | Initiates OIDC redirect. Optional `?login_hint=user@example.com` to pre-fill the IdP login form. |
| `GET` | `/auth/callback` | OIDC callback — handles the authorization code exchange. Not called directly. |
| `GET` | `/auth/session` | Returns the current dashboard session info (role, permissions, tenant). Returns `401` if not authenticated. |
| `POST` | `/auth/logout` | Ends the dashboard session and clears cookies. Redirects to the IdP end-session endpoint (if supported). |

### Multi-Tenant SSE Filtering

When authenticated via OIDC with a tenant scope, global SSE event streams (`/v1/events`) and per-session SSE streams are automatically filtered to show only events for the caller's tenant. This prevents cross-tenant data leakage in the dashboard live views.

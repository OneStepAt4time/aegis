# ADR-0024: Dashboard API Token Stays In Memory

## Status
Accepted

## Context

Issue [#1924](https://github.com/OneStepAt4time/aegis/issues/1924) hardens the
dashboard against XSS token theft. Older dashboard builds stored the long-lived
API bearer token in `localStorage` so the SPA could survive reloads. That made
any successful XSS bug a token-exfiltration bug.

The acceptance criteria allowed either:

1. an HttpOnly Secure cookie plus silent refresh, or
2. in-memory storage with the decision captured in a short ADR.

Aegis already uses bearer-token auth on the API and short-lived SSE tokens for
EventSource subscriptions. Switching the dashboard to cookie auth now would add
cookie issuance, CSRF handling, and reverse-proxy semantics that are unrelated
to the immediate hardening goal.

## Decision

- Keep the existing bearer-token API model for dashboard requests.
- Store the dashboard bearer token in Zustand memory only.
- Keep the existing short-lived SSE token exchange unchanged.
- Remove any legacy `aegis_token` entry from `localStorage` during dashboard
  startup and never write auth tokens back to browser storage.
- Serve the dashboard with a tighter CSP so the browser only allows the assets,
  connections, and inline styles the current runtime needs.

## Consequences

- **Pros:** no auth secret at rest in browser storage; smaller change than a
  cookie redesign; same-tab navigation keeps working; existing SSE flow stays
  intact.
- **Cons:** reloading the page or closing the tab clears the dashboard login and
  requires the user to paste the API token again.
- **Operational note:** reverse proxies must preserve the dashboard CSP header
  and WebSocket/SSE connectivity.

## Related

- Issue [#1924](https://github.com/OneStepAt4time/aegis/issues/1924)
- Issue #297 — short-lived SSE tokens
- [ADR-0023](0023-positioning-claude-code-control-plane.md)

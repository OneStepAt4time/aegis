API Reference — Proposed additions: model & effort fields

NOTE: The following fields are proposed and marked "proposed, awaiting backend implementation". These docs are a speculative draft to speed coordination between backend and frontend teams.

POST /v1/sessions (create session)
- request body additions (optional):
  - model: string (optional)
    - Description: Preferred model identifier for the session (e.g., "gpt-4o", "gpt-5-mini", "claude-2.1"). When provided, the backend should persist this value with the session and surface it in session list/get responses.
    - Validation: max length 200; allowed characters: alphanumeric, dash, slash, dot, underscore. Exact validation to be implemented server-side.
  - effort: string (optional)
    - Description: High-level effort hint for the session run (for UI grouping and backend scheduling). Example values: "low", "medium", "high" or CLI-friendly labels such as "quick", "balanced", "full".
    - Validation: enum or free-form string to be decided. Recommend enum ["quick","balanced","thorough"] mapped to UX labels {low,medium,high}.

Responses:
- Session object additions (when fields are present):
  - model?: string — the saved model identifier for the session
  - effort?: string — the saved effort hint for the session

Behavioral notes (proposed):
- Backward compatibility: these fields are optional. If absent, existing behavior remains unchanged.
- Migration: clients should tolerate missing fields. Dashboard and CLI may show "—" or "unspecified" when absent.
- Audit: setting a model or effort should be recorded in audit logs (session.create) for traceability.


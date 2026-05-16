API Quick Reference — Proposed additions (draft)

Note: Proposed fields are marked as "proposed, awaiting backend implementation". Do not treat this doc as binding until backend confirms schema.

Create session — POST /v1/sessions
Body (proposed additions):
- model (optional): string — Preferred model for the session (e.g. "gpt-5-mini").
- effort (optional): string — Effort hint for the session (e.g. "quick", "balanced", "thorough").

Response: session object includes optional model and effort fields when set.

Client notes:
- CLI: pass --model and --effort flags when supported. If the flags are not acknowledged by the server, clients should fall back to current behavior.
- Dashboard: will surface model/effort when backend exposes them via session list/get.


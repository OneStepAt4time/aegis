Dashboard — Proposed UI fields: model & effort

Status: proposed, awaiting backend implementation (SessionInfo.model, SessionInfo.effort)

Session table
- New columns / badges:
  - Model badge: when session.model is present, show a small badge (text) with the model name (truncate long ids). Example: [gpt-5-mini]
  - Effort indicator: show a subtle label or icon representing the declared effort (e.g., ⚡ Quick / ⚖️ Balanced / 🛠️ Thorough). Map effort codes to consistent UX labels.

Session detail
- Metadata row should include:
  - Model: <session.model || 'unspecified'>
  - Effort: <session.effort || 'unspecified'>

UX guidelines (proposed)
- If model is present, provide a tooltip with: model id, when set, source (CLI/dashboard), and time set.
- Effort mapping: standardize on a recommended set of values (quick|balanced|thorough) and display user-friendly labels.
- Backfilling: if the backend later adds model attribution retroactively, display "model (inferred)" with an audit note.

Accessibility
- Ensure badges have aria-labels and textual equivalents in the detail view for screen readers.


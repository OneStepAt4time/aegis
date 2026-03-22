# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-22

### Added
- **CLI entry point**: `npx aegis-bridge` — zero-config quick start with auto-detection
- **Permission prompt DX**: Actionable hints in health check response (`actionHints` field)
- **`aegis-bridge create` subcommand**: Create sessions from CLI
- **Stall detection**: Per-session configurable stall threshold (default: 5 min)
- **Session health endpoint**: `GET /v1/sessions/:id/health` with window/pane status
- **Prompt delivery verification**: Retry logic via `capture-pane` confirmation
- **StopFailure hook support**: Detect CC errors via hook integration
- **Filesystem discovery fallback**: Session ID discovery when hooks are unavailable
- **Bare flag detection**: Handle `claude --bare` which skips hooks
- **Session state archive**: Auto-archive stale JSONL session files on spawn

### Fixed
- **Stale session reuse**: Timestamp + mtime guards reject old claudeSessionId (#6)
- **Tmux window creation**: Retry logic (3x) for prolonged uptime (#7)
- **Session spawn failure**: Health check between retries (#7)

## [1.0.0] - 2026-03-21

### Added
- Initial release
- HTTP API for Claude Code session management via tmux
- Session CRUD: create, read, send, approve, reject, interrupt, kill
- JSONL transcript parsing
- Terminal state detection (working, idle, permission_prompt, stalled)
- Telegram channel for event notifications
- Webhook channel for event notifications
- Configuration via `~/.aegis/config.json`
- Migration support from `~/.manus/config.json`

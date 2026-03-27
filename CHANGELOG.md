# Changelog

All notable changes to this project will be documented in this file.

## [1.3.3] - 2026-03-27

### Added
- **WebSocket terminal streaming**: Live terminal with xterm.js frontend + WS endpoint (#310)
- **Batch session creation UI**: Dashboard modal with single/batch tabs (#312)
- **ResilientEventSource**: Backoff + circuit breaker for SSE reconnection (#308)
- **SSE back-pressure**: Disconnect slow clients via SSEWriter (#302)
- **Global event ring buffer**: 50-event ring with Last-Event-ID replay (#301)
- **Expanded CC hook events**: PreCompact, PostCompact, Notification, Elicitation, FileChanged, CwdChanged (#208)
- **WebSocket terminal endpoint**: `WS /v1/sessions/:id/terminal` (#108 Sprint 3)
- **Session list pagination + paginated transcript**: `GET /v1/sessions?limit&cursor`, `GET /v1/sessions/:id/transcript?limit&offset` (#109, #206)
- **Agent swarm awareness**: Detect CC teammate sessions + Telegram `/swarm` command (#81, #71)
- **Tech debt cleared**: All 36 items from #89 (100%) — backoff, logging, error handling, DCS stripping, compacting state, etc.
- **Security hardening**: CORS, security headers, token redaction, rate limiting, Zod validation, path traversal protection, SSRF prevention (#217-#230)
- **Dashboard metrics**: Per-session latency endpoint (#87)

### Fixed
- **P0: Prompt delivery reliability** — capture-pane verification after send-keys (#285, #289)
- **P0: Hook-based permission approval** — auto-approve with audit logging (#284, #288)
- **P0: Zombie session reaper** — auto-remove dead sessions after grace period (#283)
- **P0: Workspace trust dialog** — always inject `--settings` flag (#194, confirmed in v1.3.2)
- **PermissionRequest hook mapping** — map to `permission_prompt` not `ask_question` (#257)
- **State persistence race condition** (#218), pipeline stage config loss (#219)
- **MCP listSessions pagination regression** (#254)
- **Rules of Hooks violation** in dashboard (#231)
- **Race conditions**: dashboard SSE flicker, double-submit, stale closures (#306)
- **AbortError retry defeated cancellation** (#298), stale debounce timers (#299)
- **SSE robustness**: emitter cleanup race, idle timeout, circuit breaker (#308)
- **Memory leak**: unbounded sessionMessages growth (#296)
- **Dashboard crash** on undefined sessionId (#294)
- **Default to bypassPermissions** for headless sessions (#320)
- **~50 additional dashboard/backend fixes** from comprehensive review

### Tests
- 1,246 → 2,176 tests (+74%)


## [1.3.2] - 2026-03-26

### Fixed
- **Workspace trust dialog**: Always inject `--settings` flag to prevent CC workspace trust prompts on first open (#194)

## [1.3.1] - 2026-03-26

### Added
- **Latency metrics dashboard**: Per-session latency tracking + `GET /v1/sessions/:id/latency` endpoint (#87)
- **fs.watch-based JSONL monitoring**: Replace polling with filesystem events for real-time transcript updates (#84)
- **tmux socket isolation**: Socket isolation via `-L aegis-{pid}` to prevent cross-process conflicts (#83)
- **Subagent lifecycle tracking**: Track subagent spawn/stop via CC hooks (#88)
- **Pane title for debugging**: Set tmux pane title to session name for easier identification (#82)
- **14 CC hook events**: Expanded from 3 to 14 hook events with full status mapping (#85)
- **Permission auto-approve**: Auto-approve permission prompts with audit logging (#79)

## [1.3.0] - 2026-03-26

### Added
- **HTTP hooks architecture** (#169) — 4-phase implementation:
  - Phase 1: `POST /v1/hooks/:eventName` endpoint for registering HTTP callbacks
  - Phase 2: CC `settings.json` injection with HTTP hooks on session create
  - Phase 3: Hook-driven status detection with adaptive polling
  - Phase 4: Dashboard SSE streaming from hook events

### Changed
- **Dashboard**: ~20 bug fixes and improvements (#129–#160):
  - Toast notifications for error handling (#139)
  - ARIA accessibility + keyboard support (#156)
  - Polling consolidation via SSE (#154)
  - React key fix for session list (#157)
  - Firefox scrollbar fallback (#160)
  - API client wrappers for dashboard endpoints (#149)
  - AbortSignal support + retry logic (#150, #151)
  - Zod runtime validation for API responses (#129)
  - Security headers + cache-control (#145, #146)
  - Memoized session lookup in ActivityStream (#159)
  - Click-to-expand for ApprovalBanner prompt (#142)
  - 404 detection via statusCode instead of string matching (#143)
  - SPA fallback URL scope fix + kill session navigation (#144, #135)
  - Modal form reset on close + metrics error state (#140, #141)
  - Dead code removal and `formatSeconds` deduplication (#152, #158)
  - Batch fixes for stale closures, duplicate buttons, unused variables (#130–#138)

### Stats
- Tests: 1246 → 1384 (+138)
- 66 commits, ~30 issues closed

## [1.2.0] - 2026-03-22

### Added
- **Screenshot capture**: `POST /v1/sessions/:id/screenshot` — headless Chromium via Playwright (optional dep)
- **Webhook event delivery**: Session lifecycle events POSTed to configured webhooks with 3x retry + backoff
- **Auto-approve mode**: `autoApprove: true` on session create for CI/batch — auto-approves permission prompts with audit log
- **376 tests** covering all features

## [1.1.0] - 2026-03-22

### Added
- **CLI entry point**: `npx aegis-bridge` — zero-config quick start with auto-detection of tmux and Claude Code
- **`aegis-bridge create` subcommand**: Create sessions directly from CLI with brief and cwd
- **Permission prompt DX**: Actionable `actionHints` in health check and session responses for `permission_prompt` / `bash_approval` states
- **Stall detection**: Per-session configurable stall threshold (default: 5 min)
- **Session health endpoint**: `GET /v1/sessions/:id/health` with window/pane status
- **Prompt delivery verification**: Retry logic via `capture-pane` confirmation
- **StopFailure hook support**: Detect CC errors via hook integration
- **Filesystem discovery fallback**: Session ID discovery when hooks are unavailable
- **Bare flag detection**: Handle `claude --bare` which skips hooks
- **Session state archive**: Auto-archive stale JSONL session files on spawn
- **376 tests** covering all features

### Fixed
- **Stale session reuse**: Timestamp + mtime guards reject old claudeSessionId (#6)
- **Tmux window creation**: Retry logic (3x) for prolonged uptime (#7)
- **Session spawn failure**: Health check between retries (#7)
- **Field bug**: Always run filesystem discovery as fallback (#19)

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


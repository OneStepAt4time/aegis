# Changelog

All notable changes to this project will be documented in this file.

## [1.4.0] - 2026-03-28

### Added
- **Automated release pipeline**: npm publish + GitHub Releases via CI (#365)
- **Headless question answering**: PreToolUse hook enables Q&A in headless mode
- **Pipeline management page**: Dashboard UI for pipeline orchestration
- **Zod validation for all API routes**: Input validation with safeParse (#359)
- **SSRF validation utility**: Shared DNS-check for webhook/screenshot URLs (#346)
- **SSE connection limits**: Per-IP and global connection limiting
- **WS terminal security hardening**: Token-based auth for WebSocket endpoints
- **Short-lived SSE tokens**: Time-limited tokens for EventSource connections

### Fixed
- **Security audit hardening**: Resolve vulns, block CI on high-sev, lockfile lint (#366)
- **Auth bypass via broad path matching**: Stricter middleware path matching (#349)
- **Command injection in hook.ts**: Sanitize TMUX_PANE env var (#347)
- **Shell injection in tmux.ts**: Escape all user inputs (#358)
- **Terminal parser edge cases**: Reduce false positives in state detection (#362)
- **Input validation gaps**: NaN/isFinite guards, UUID format, port clamping (#359)
- **Graceful shutdown and crash recovery**: Clean teardown on SIGTERM/SIGINT (#361)
- **Monitor stall detection edge cases**: Fix false stall detection (#356)
- **Swarm parent matching**: Use PID for teammate detection (#353)
- **TmuxManager overhead**: Reduce session creation latency (#363)
- **Unbounded maps and memory leaks**: Fix memory growth across modules (#357)
- **Authentication on inbound Telegram messages**: Proper auth for Telegram bot (#348)
- **Flaky backoff assertions**: Loosen timing in channel tests (#378)
- **Mock assertion bugs**: Fix type errors in test files (#360)
- **Package hygiene for npm**: Clean exports and module structure (#364)

### Tests
- 1,428 tests (62 test files) — coverage increased across all modules

### Known Issues
- #390: Crash detection relies only on stall timer (5 min), missing pane-exit detection
- #391: SSE /v1/sessions/:id/events not streaming pane-content for working sessions

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

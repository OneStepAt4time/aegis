# Competitive Intelligence — cc-connect (chenhg5/cc-connect)

**Last updated:** 2026-05-30  
**Previous update:** 2026-05-07  
**Updated by:** Scribe (Athena assignment)

## Current Stats

| Metric | Value | Change since 2026-05-07 |
|--------|-------|------------------------|
| Stars | 11,043 | +3,543 (+47% in 23 days) |
| Forks | 1,009 | +260 |
| Open issues | 479 | +~100 |
| Latest stable | v1.3.2 (2026-04-21) | No new stable |
| Latest beta | v1.3.3-beta.4 (2026-05-27) | 4 beta releases since tracking |
| Language | Go | — |
| License | None | — |
| Description | Bridge local AI coding agents to messaging platforms | Expanded to include Cursor, Gemini CLI, Codex |

## Version History (since 2026-05-07)

### v1.3.3-beta.4 (2026-05-27)
- Fixed web console 404 regression in release builds
- Fixed Slack @mention parsing without trailing space
- Fixed DingTalk picture message handling
- Fixed Feishu require_mention=false ignored
- Fixed AskUserQuestion resolved by empty delivery receipts (security fix)
- Fixed Codex env config not honored at startup
- Fixed Codex explicit stdio app-server URL lost across restarts
- Fixed OpenCode session ID extraction and yolo mode
- Fixed Feishu concurrency safety and Windows test compat
- **New:** `max_turn_time_mins` config — absolute wall-clock cap per agent turn with two-phase shutdown
- 8 external contributors

### v1.3.3-beta.3 (2026-05-24)
- Blackbox testing framework (Phase 1-2)
- Cursor and OpenCode agent support in tests
- Codex stdio sentinel for app_server backend
- Kimi session UUID capture from stderr

### v1.3.3-beta.2 (2026-05-09)
- Slack Assistant API support with Agent toggle
- DingTalk richText message support
- MAX messenger webhook delivery mode
- Claude Code project-level environment variables
- `display_mode` enum replacing `quiet` boolean
- Claude Code custom system prompt configuration
- Bridge security: require token when Bridge is enabled

## Platform Coverage

**Chat platforms (12):**
Feishu/Lark, DingTalk, Slack, Telegram, Discord, LINE, WeChat Work (企业微信), WeChat (微信), QQ Bot, MAX messenger, iMessage (via bridge), Web console

**AI agent backends (10+):**
Claude Code, Cursor, Gemini CLI, Codex, OpenCode, Kimi, Devin, Trae CLI ACP, COCO ACP, NekoCode, VisionCoder, AIHubMix

## Release Cadence

- 4 beta releases in 23 days (May 7 → May 30)
- Average: ~1 beta every 5-6 days
- External contributor activity: 8 contributors in beta.4 alone
- Stable v1.3.2 released 2026-04-21 — v1.3.3 stable expected soon

## New Features Since Last Tracking

| Feature | Aegis Status | Priority |
|---------|-------------|----------|
| Cursor agent support | ❌ Not started | Phase-4c per ADR-0032 |
| OpenCode agent support | ❌ Not started | Phase-4c |
| Kimi agent support | ❌ Not started | Phase-4c |
| `max_turn_time_mins` wall-clock cap | ⚠️ Aegis has idle timeout, not per-turn cap | Medium — useful for production |
| Codex env config + stdio app-server | ✅ ADR-0032 covers Codex via NdjsonRpcTransport | In progress (#3180) |
| Slack Assistant API | ❌ Aegis has basic Slack | Medium |
| Blackbox testing framework | ⚠️ Aegis has E2E tests | Maintain advantage |
| `display_mode` enum | ⚠️ Aegis uses verbose config | Low |

## Growth Trajectory

- 7,500 → 11,043 stars in 23 days = **+47% growth**
- Fork rate: ~11 new forks/day
- Issue velocity: ~4-5 new issues/day
- External contributor count increasing (8 in latest beta)

This is sustained hypergrowth. cc-connect is on track for 15K+ stars by end of June 2026 at current velocity.

## Files for Reference
- Previous tracking: `cc-connect-tracking-2026-05-07.md`
- Issue analysis: #3004
- Competitive landscape: #3016
- Threat matrix: `docs/competitive-threat-matrix.md`

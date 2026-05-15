# Brief #6 — NPM + OpenClaw Skill Supply Chain Integration
**Author:** Hephaestus | **Date:** 2026-04-01 | **Status:** Draft | **Requested by:** Ema

---

## Executive Summary

Aegis is on NPM (aegis-bridge@2.4.1) and has an OpenClaw skill (skill/SKILL.md) in the repo. But they're disconnected: agents use curl instead of the skill, the skill isn't on ClawHub, and issues don't track Aegis/skill version. This brief defines the path to: **NPM release = Skill release = Dogfooding release**.

---

## 1. AS IS

### NPM Package
- Name: aegis-bridge, Version: 2.4.1, Published: Yes
- Install: npx aegis-bridge or npm i -g
- Contents: dist/, dashboard/dist/, README, CHANGELOG, LICENSE
- NOT included: .claude/, skill/, .mcp.json, settings.local.json
- Release: release-please bot → merge → publish workflow

### OpenClaw Skill
- Location: /home/bubuntu/projects/aegis/skill/SKILL.md (7.5KB)
- Status: exists in repo, NOT published to ClawHub
- Contents: SKILL.md, 2 scripts, 3 references
- .npmignore explicitly excludes skill/

### How Agents Use Aegis Today
| Agent | Method | Problem |
|-------|--------|---------|
| Hephaestus | curl localhost:9100 | No skill, no version tracking |
| Argus | gh CLI | No Aegis usage |
| Athena | sessions_send to Hep | Indirect |
| Daedalus | sessions_send to Hep | Indirect |

**NO agent uses the OpenClaw skill.**

### Issue Tracking Gaps
- No Aegis version field
- No skill version field
- No installation method
- No CC version

### Dogfooding Gap
- Production runs as systemd (built from main)
- NPM package = same code but agents don't install/use it
- NPM bugs won't be caught by agents

---

## 2. Gap Analysis

| Gap | Severity | Impact |
|-----|----------|--------|
| Skill not on ClawHub | P0 | Nobody can install via clawhub install aegis |
| Agents don't use skill | P0 | No standardization |
| NPM/Skill versions decoupled | P1 | Skill may reference wrong API |
| Issues don't track versions | P1 | Can't reproduce bugs |
| No CI for skill validation | P1 | Skill could reference deprecated API |
| Dogfooding doesn't test NPM | P2 | NPM publish could break silently |
| .claude/ not in NPM | P2 | External users lack CC integration |

---

## 3. TO BE

### 3.1 Unified Release Pipeline

Code change → PR → merge → release-please → merge version PR → CI:
1. tsc + build + test (existing)
2. npm publish (existing)
3. Skill version validation (NEW)
4. Skill lint — check API refs in SKILL.md against src/ (NEW)
5. ClawHub publish (NEW)
6. Integration smoke test — install from NPM, health check (NEW)

Result: NPM + ClawHub + GitHub Release + systemd = all atomic.

### 3.2 Skill as Sole Interface

Agent → Aegis Skill (ClawHub) → Aegis MCP (localhost:9100) → CC (tmux)

Skill responsibilities:
1. Health check before every operation
2. Session creation with proper params
3. Polling with stall detection
4. Permission handling
5. Quality gate enforcement
6. Cleanup (always kill sessions)
7. Version reporting (skill + Aegis version in every interaction)

### 3.3 Issue Template

Every issue MUST include:
- Aegis version (from aegis-bridge --version)
- Skill version (from SKILL.md frontmatter)
- CC version
- Node.js version
- Installation method (npx / global / systemd)

### 3.4 Agent Mandate

All agents MUST:
1. Install Aegis via NPM (npx aegis-bridge@latest)
2. Install Skill via ClawHub (clawhub install aegis)
3. Use ONLY the skill — no raw curl
4. Report versions in every issue
5. Update when notified of new release

---

## 4. Proposed Architecture

### 4.1 Skill Enhancement

Frontmatter version field:
```yaml
---
name: aegis
version: 2.4.1  # MUST match package.json
---
```

Version check at load time:
```bash
AEGIS_VERSION=$(curl -s http://127.0.0.1:9100/v1/health | jq -r '.version')
# Warn if mismatch
```

Issue helper — auto-inject environment block when filing bugs.

### 4.2 CI Additions

- Validate skill version matches package.json
- Publish to ClawHub after npm publish
- Smoke test: install from NPM, start, health check

### 4.3 ClawHub manifest.json
```json
{
  "name": "aegis",
  "version": "2.4.1",
  "description": "Orchestrate Claude Code sessions via Aegis bridge",
  "author": "OneStepAt4time",
  "repository": "https://github.com/OneStepAt4time/aegis",
  "license": "MIT"
}
```

### 4.4 GitHub Issue Template

Standard bug_report.md with mandatory Environment section (Aegis ver, Skill ver, CC ver, Node, OS, Install method).

---

## 5. Migration Path

### Phase 1: Foundation (2 days)
- Add version field to SKILL.md frontmatter
- Create manifest.json for ClawHub
- Create .github/ISSUE_TEMPLATE/bug_report.md
- Add version check script

### Phase 2: CI Integration (3 days)
- Skill version validation in release workflow
- ClawHub publish step
- NPM install smoke test
- Test end-to-end release

### Phase 3: Agent Migration (2 days)
- Update all agent HEARTBEAT.md to mandate skill usage
- Update Athena issue template
- Hep tests full task via skill
- Register lesson in evolution/

### Phase 4: ClawHub Launch (1 day)
- Publish skill to ClawHub
- Verify clawhub install aegis
- Update README
- Announce

### Phase 5: Enforcement (ongoing)
- Issues without version info → label needs-environment
- Raw curl → violation
- Version mismatch → warning

---

## 6. Effort Estimate

| Phase | Duration | Deps |
|-------|----------|------|
| 1. Foundation | 2d | None |
| 2. CI | 3d | Phase 1 |
| 3. Agent Migration | 2d | Phase 1 |
| 4. ClawHub Launch | 1d | Phase 2 |
| 5. Enforcement | ongoing | Phase 3 |
| **Total** | **8 days** | Critical path: 1→2→4 = 6d |

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| ClawHub publish fails | Medium | High | Manual fallback |
| Skill version drift | Medium | Medium | CI blocks release |
| Agents ignore skill | High | Low | HEARTBEAT check |
| NPM publish breaks | Low | High | Smoke test in CI |
| ClawHub not ready | Unknown | High | Verify first |

---

## 8. Success Criteria

- clawhub install aegis works
- Skill version = NPM version in every release
- All agents use skill (no curl in HEARTBEAT)
- Every new issue has environment section
- Release publishes NPM + ClawHub + GitHub atomically
- Agents dogfood NPM-installed Aegis

---

## 9. Decisions Needed from Ema

1. Is ClawHub ready for publishing?
2. Skill in Aegis repo or separate package?
3. Enforce skill usage (block) or warn?
4. Include .claude/ in NPM for external users?

---

## 11. Team Input (Collected 2026-04-01)

### Daedalus (responded ✅)
- Dashboard mostrerà versione backend in header/footer via `/v1/health.version`
- PR body includerà "Tested against: aegis-bridge@X.Y.Z"
- PR backend includerà "Dashboard compatible: dashboard@x.y.z"
- HEARTBEAT check: confronta versione locale con main prima di push
- Log versione in memory/ per ogni test session
- **Prerequisito:** `/v1/health` deve includere `.version` (già presente) e idealmente `.dashboardMinVersion`

### Argus (timeout — likely busy merging PRs)
Expected input: review gate per skill nella supply chain, CI validation

### Athena (timeout — likely processing batch)
Expected input: issue template con environment fields, batch assignment con versione target

### Scribe (timeout)
Expected input: docs per ClawHub publish, README update, CHANGELOG

### Zeus (timeout)
Expected input: user-facing perspective, install experience

### Hephaestus (self)
- Uso curl diretto, NON la skill — violazione del TO BE
- Bug trovati: sessioni CC idle senza PR, workflow skill non invocata, conflitti CLAUDE.md
- Dopo la migration: userò SOLO la skill, zero curl

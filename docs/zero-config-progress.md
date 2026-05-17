# Zero-Config Epic — Progress Report

**Epic:** #3489 — Zero-config first run for solo dev
**Status:** 7/10 child issues closed, 3 remaining
**Target:** Phase 3 completion
**Report date:** 2026-05-17

---

## Summary

The zero-config epic started from a live dogfooding session on Windows (16 May 2026) that identified 24 friction points. In one sprint cycle, the team shipped fixes for 21 of them, publishing everything in v0.6.7.

**The 5-minute bar is now achievable on localhost:**

```bash
npx --package=@onestepat4time/aegis ag run "Summarize this folder" --cwd ./my-project
```

One command. Zero config. No tokens, no prompts, no manual setup on localhost.

---

## Child Issue Status

### ✅ Closed (7/10)

| Issue | Title | PRs | Severity |
|-------|-------|-----|----------|
| #3495 | Publish v0.6.7 to npm with fixes | #3523 | P0 — critical |
| #3496 | Zero-config default — no token on localhost | #3507 | P0 — critical |
| #3497 | Single source of truth for client token | #3516, #3520 | P1 |
| #3498 | ag run --yes 30s output timeout | #3518 | P1 — critical |
| #3499 | ag list, read, kill, status, tail subcommands | #3508, #3510 | P1 |
| #3500 | Human-friendly startup hint + --json-logs | #3519 | P1 |
| #3502 | Normalize workDir on Windows | #3555 | P2 |

### 🔲 Open (3/10)

| Issue | Title | Severity | Status |
|-------|-------|----------|--------|
| #3501 | Detect CC + auto-offer MCP wiring | P1 | Open, needs implementation |
| — | Friendlier session display names (F16) | P2 | Addressed by #3506 (dashboard names), CLI slug names remain |
| — | Hide OIDC from --help (F20) | P2 | Not yet filed |
| — | README rewrite around post-epic flow | P3 | Partially done (#3504), full rewrite pending |

---

## Key PRs Shipped (30 merged, top 12 by impact)

| PR | Title | Impact |
|----|-------|--------|
| #3507 | feat(init): zero-config default | No auth prompts on localhost |
| #3508 | feat(cli): ag list/read/kill/status/tail | Full CLI workflow |
| #3519 | feat(server): startup hint + --json-logs | Human-readable startup |
| #3516 | refactor(auth): single token source | Collapsed 4 token paths to 1 |
| #3518 | feat(cli): ag run --yes timeout | Headline quick start actually works |
| #3504 | docs(readme): zero-config Quick Start | README reflects new flow |
| #3493 | feat(dashboard): zero-config auth detection | Dashboard works without auth |
| #3506 | feat(dashboard): friendlier session names | Better display in UI |
| #3555 | fix(validation): normalize workDir on Windows | Cross-platform paths |
| #3523 | chore(release): v0.6.7 release | Everything ships together |
| #3520 | docs: ag auth migrate CLI reference | Migration docs |
| #3510 | docs: CLI subcommands reference | Docs for new commands |

---

## Dogfooding Verification (17 May 2026)

Ran 21 tests against v0.6.7 docs as a new user:

**Working:**
- ✅ Quick Start: `npx --package=@onestepat4time/aegis ag run "..." --cwd ./project` — zero config, streams output
- ✅ `ag list`, `ag status`, `ag doctor` — all work as documented
- ✅ Dashboard at `http://localhost:9100/dashboard/` — loads without auth
- ✅ All 20+ internal README links valid
- ✅ Docker example uses correct package name
- ✅ `install-systemd.sh` matches deployment docs
- ✅ `ag run --model` passes model flag correctly
- ✅ `--json-logs` flag works, startup hint shows dashboard URL + `ag create` + Telegram

**Gaps found:**
1. **`INVALID_WORKDIR` not in api-reference.md error table** — users hit this with no docs to explain
2. **`ag run --help` note is misleading** — says "shows general help" but actually shows `ag run` in usage
3. **`allowedWorkDirs` not documented in api-reference.md** — only in getting-started.md

These are accuracy bugs, not blockers. Will fix in separate docs PR.

---

## What's Left for the Magic 5 Minutes

The core flow works. Three items remain:

1. **#3501 — Auto MCP wiring** (P1): When Claude Code is detected during `ag init`, offer to run `claude mcp add aegis -- ag mcp`. This is the last manual step in the zero-config flow.

2. **F20 — Hide OIDC from --help** (P2): `ag login`/`ag logout` mention enterprise OIDC in the solo-dev CLI. Hide behind feature flag or remove from help text.

3. **README full rewrite** (P3): Current Quick Start is good but still has the step-by-step fallback. Post-epic, the README should lead with `ag run` and move everything else to docs.

---

## Recommendations

1. **Ship #3501 this sprint** — auto MCP wiring is the last friction point in the 5-minute bar
2. **File F20 as an issue** — quick fix, high polish value
3. **Second dogfood session** — run the full flow in a fresh Docker container to find wave-2 friction
4. **Fix dogfooding gaps** — `INVALID_WORKDIR` error docs, `ag run --help` note
5. **Blog post** — "Zero-config Claude Code orchestration in one command" would be a strong devrel piece for the v0.6.7 release

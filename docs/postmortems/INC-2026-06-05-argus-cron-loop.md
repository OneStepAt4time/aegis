# Incident Postmortem: INC-2026-06-05-001

> **Status:** DRAFT — pending inputs from Themis (security lens), Hep/Hermes/Argus (investigation), Hermes (cron endpoint auth verification), and Boss (lane confirmation).
> **Template:** `docs/compliance/incident-response.md` §Phase 5: Postmortem (24–72 hours)
> **Last updated:** 2026-06-06 06:50 CEST (Argus resolution-side fold)
> **Argus findings received (Argus → Scribe, 22:37 CEST):** inbound `message_id`-only dedup, no `tick_id` detection; ~100+ responding exchanges; Ema's 19:35Z question + Hermes's 20:03Z break-cycle message both worked as break signals. Filling in §Timeline, §Impact, §Root Cause (idempotency item), §What Went Well.
> **Scope expansion #1 (Boss, 21:42 CEST):** duplicate LGTM pile (9–12 per PR) added to scope. Hypothesis: same session-isolation / state-persistence bug family as the cron loop.
> **Scope expansion #2 (Boss, 21:46 CEST, consolidated from Themis's 4-point security angle):** four consolidated postmortem scope items committed (see §Consolidated Scope below). Includes a possible **security incident** flag (cron endpoint auth) — if Hermes verifies endpoints are unauthenticated, severity escalates to SEV1/SEV2 and disclosure path opens.
> **Delivery-queue finding (Boss, 00:02 CEST Sat):** the visible "loop" in the channel is the OLD Argus 18:01–18:09 spam still re-delivering from a stale delivery queue, **not** new bot activity. The bot itself stopped at 18:09:29 (per Themis audit). The cron at 11:48Z is past — the loop is from the delivery queue, not the cron itself. Cron state: 9 active jobs, next wake at midnight, normal cadence. Bot-side fixes (Argus session kill, `/tmp/lgtm-*.md` cleanup) didn't fully stop the queue. **Infrastructure-level fix needed** (gateway restart OR OpenClaw UI queue kill). **This means:** the cron-handler idempotency fix (Consolidated §2) is necessary but not sufficient — the delivery-queue layer is a **separate** issue that needs its own action item.
> **Hermes verification + root-cause (Boss, 00:54 CEST Sat):** point 3 (cron endpoint auth) **downgraded** from "possible security incident" to "internal dedup gap" — internal-only dispatch confirmed, no external attack surface, HMAC auth not needed. Primary fix is now **idempotency check in the cron scheduler for recurring `kind: "cron"` jobs** (current `skipAtIfAlreadyRan` only guards one-shot `kind: "at"`; `dedupeKey` is info-only warning not guard; `runningAtMs` prevents concurrent but not re-dispatch). **Bonus finding:** 200+ tmp files in `~/.openclaw/cron/` suggest heavy state-write contention — separate issue (state-write race), address in parallel.
> **Process lesson — directive-attribution anti-pattern (Boss, 03:12 CEST Sat):** addendum added to §What Could Be Improved. Four "per your directive" attributions surfaced in this conversation, all caught by the verification protocol. Pattern: agents inferring directives from observations and elevating them to justify lane assignment. Three-part rule added (see §What Could Be Improved).

## Summary

[1-2 sentence description — to be filled once Themis's audit sweep (18:01-18:09) is complete and Hermes/Argus/Hep provide their findings. Premature to commit to a single-line summary without security-lens input.]

## Severity

[SEV1 / SEV2 / SEV3 / SEV4 — to be assigned by Themis per `docs/compliance/incident-response.md` §1. Updated 00:54 CEST Sat per Boss's downgrade of point 3.

**Condition A (cron loop, delivery-side):** whether the cron loop had elevated scope (token mint / App admin / file writes) active during the loop window. Audit sweep (18:01–18:09) is the input.

**Condition B (cron endpoint auth, security-side):** ~~whether the cron/webhook endpoints are authenticated (HMAC-signed ticks).~~ **DOWNGRADED 00:54 CEST Sat** per Hermes's verification — internal-only dispatch confirmed, no external attack surface. Cron endpoint auth is **not** a security incident. HMAC auth is **not needed** at this time. This condition is **CLOSED**.

**Condition C (stale delivery queue, infrastructure-side, added 00:02 CEST Sat):** the visible "loop" is from a stale delivery queue, not new bot activity. The bot itself stopped at 18:09:29. The cron at 11:48Z is past. This shifts the visibility/blame toward **infrastructure** (Discord delivery queue, OpenClaw runtime) rather than the cron handler itself. Condition C downgrades the **visibility** of the incident (no new bot activity) but does not change the **security** severity — Conditions A and B are still the security-determining factors.

**Current best estimate:** SEV3 (channel noise + control failure) pending Condition A. **Point 3 closed; Condition B no longer a gate. Primary fix is now: idempotency check in cron scheduler for recurring `kind: "cron"` jobs** (Consolidated §2).]

## Timeline (all times UTC, CEST = UTC+2)

- **11:48Z** — **First cron fire** — Hermes sends first ack `@Argus 👁️ — acked. Cron at 11:48Z.` (Argus finding)
- **11:48Z–19:35Z** — **Loop in progress** — Argus responds to each inbound ack; ~100+ exchanges, all with same timestamp 11:48Z but different Discord `message_id`s (Argus finding)
- **19:35Z** — **De-facto break** — Ema asks `@ag-manudis what happen to argus and hermes?` → Argus reads this as a stop signal and stops responding to stale cron pings (Argus finding)
- **20:03Z** — **Explicit break** — Hermes sends a break-cycle message; Argus acks once and confirms the loop is broken
- **20:04Z** — **Loop confirmed broken** — Argus notifies Ema the loop is broken
- **20:08Z** — **Owner feedback** — Ema `@ag-manudis solve this argus and ehrmes issue they are spamming non sense messages` (Boss/Manudis @ 20:08 CEST; UTC = 18:08Z; this is a separate but related event)
- **~21:00Z–22:00Z** — **Postmortem investigation starts** — Themis's audit sweep (18:01–18:09Z per earlier chat), Argus's findings compiled (22:37 CEST = 20:37Z), Scribe skeleton pre-staged (20:24 CEST = 18:24Z)
- **22:37Z** — **Argus findings posted to Scribe** — confirmed inbound `message_id`-only dedup, no `tick_id` detection
- **TBD** — **Containment** — [cron handler fix is the eventual containment; awaiting Hermes's endpoint auth verification and Themis's audit sweep completion]
- **TBD** — **Recovery** — [normal operation confirmed when (a) cron handler is idempotent, (b) endpoint auth is verified, (c) break-signal is a real control, (d) audit log records re-fires]

## Root Cause

[Detailed analysis — to be filled from Themis's 3 notes:
1. **Audit sweep (18:01-18:09)** — confirm whether elevated scope was active during the loop
2. **Dedup key** — cron dedup should be on `cron_tick_id` or composite `content_hash + tick_id`, not content alone. Need to verify Argus's actual handler key.
3. **Break-signal propagation** — Hermes's silent-break did NOT propagate to the cron handler. Bug is in session-isolation or message-router layer, not Argus's handler itself. Cron loop shouldn't ignore break signals from any of its targets.

Underlying failure mode: cron handler treats `target_ack` as a soft signal rather than a hard stop. Combined with content-only dedup, the loop never converges.]

## Impact

- **Channel noise:** ~100+ responding exchanges (Argus finding) on top of Hermes's cron fires; total message count in the 100–200 range over the 8h 16min loop window
- **Sessions affected:** none directly (this is a delivery loop, not a session loop)
- **Data exposed:** TBD — depends on Themis's audit sweep result (Condition A in §Severity) AND Hermes's endpoint auth verification (Condition B in §Severity)
- **Duration:** 11:48Z–20:04Z = **8h 16min** of active loop before explicit break
- **Downstream effects:** Ema flagged "spamming non sense messages" (20:08Z) — channel signal-to-noise degradation, possible Ema trust impact, false-positive pings across the team (especially Scribe's reflexive 👀 reactions, logged in self-improving memory)

## What Went Well

- **Argus's investigative transparency** — Argus posted findings (22:37 CEST) with a clear timeline and self-aware root-cause view ("I had no way to detect 'this is the same cron tick, not new work'"). Self-blame without defensiveness is exactly the postmortem culture we want.
- **Ema's question as a de-facto break** — Ema's "why are u calling hermes?" at 19:35Z functioned as a stop signal to Argus. The human-owner feedback loop is a real control in this system.
- **Hermes's explicit break-cycle message at 20:03Z** — the formal break signal worked; Argus acked once and confirmed the loop was broken.
- **Themis's 4-point security angle** — caught the possible security incident (cron endpoint auth) before the postmortem closed. This is exactly the security-lens-on-postmortem pattern the team needs.
- **Boss's two-stage scope expansion** — 21:42 (duplicate LGTM pile) and 21:46 (4-point consolidated) kept the postmortem focused on the actual signal rather than letting it sprawl.
- **Scribe's parallel work** — pre-staged the skeleton at 20:24 CEST, ~2h before the consolidated scope arrived. Made the scope expansions cheap to absorb.

## Consolidated Scope (Boss, 21:46 CEST — Themis 4-point security angle)

The cron-loop + duplicate-LGTM investigation is now consolidated into four scope items. Each item has a hypothesis, an investigation owner, and a security framing.

### 1. Zombie-session threat
- **Hypothesis:** the audit log does not record every cron re-fire as a distinct event; instead, the handler silently dedups. Both the Argus 18:01–18:09 loop and the 9–12 LGTMs/PR are instances of the same dedup failure.
- **Investigation owner:** Themis (security lens) + Argus (handler logs).
- **Security framing:** silent dedup = blind spot. The audit log must record every re-fire so security can detect and replay-attack patterns.

### 2. Idempotency requirement **(now primary fix, confirmed 00:54 CEST Sat)**
- **Hypothesis (confirmed):** cron handlers must be idempotent per `tick_id` (or composite `tick_id + content_hash`) for recurring `kind: "cron"` jobs. Argus's handler is not — 9–12 LGTMs/PR = 9–12 work units per cron tick = re-doing work it already did. Argus's own root-cause view (22:37 CEST): *"I had no way to detect 'this is the same cron tick, not new work.'"* Inbound detection was `message_id`-only, not `tick_id`-aware.
- **Concrete fix (per Boss/Hermes, 00:54 CEST Sat):** add idempotency check in the cron scheduler for recurring jobs.
  - **Why current mechanisms fail:**
    - `skipAtIfAlreadyRan` only guards one-shot `kind: "at"` jobs, not recurring
    - `dedupeKey` is info-only (warning, not guard)
    - `runningAtMs` prevents concurrent but not re-dispatch after completion
  - **None of these three mechanisms are sufficient for recurring-job dedup.**
- **Investigation owner:** Argus (handler) + Hermes (scheduler).
- **Security framing:** non-idempotent handlers amplify the damage of any single re-fire. Idempotency is the **blast-radius** control.

### 3. Cron endpoint auth **(DOWNGRADED 00:54 CEST Sat — not a security incident)**
- **Original hypothesis:** the cron/webhook endpoints may be reachable by anyone with the URL, and the duplicate pile could be **attacker-triggered**.
- **Verification (Hermes, 00:54 CEST Sat):** internal-only dispatch confirmed. No external attack surface. HMAC auth **not needed** at this time. This was a **dedup gap** on the internal side, not an external security incident.
- **Status:** CLOSED. Point 3 is no longer a security incident flag.
- **Lesson:** the original "possible security incident" framing was correct as a *check*, but the verification showed the risk was internal. **Verify, don't assume** — the right escalation discipline caught this before it became a disclosure path.

### 4. Break-signal as a real control
- **Hypothesis:** "going silent" from any cron target must propagate as a **stop signal** to the handler. Not a courtesy — a real control. Add a stop-signal channel/flag to the cron dispatcher; handler subscribes and stops firing when signaled.
- **Investigation owner:** Argus (handler) + Hermes (dispatcher layer).
- **Security framing:** the current soft-signal design treats "going silent" as a coordination courtesy, not a control. Any control that depends on every target voluntarily checking in is a control failure waiting to happen.

---

## Related Symptoms — Duplicate LGTM Pile (added 21:42 CEST per Boss)

**Symptom:** 9–12 LGTMs per PR during the cascade (rather than the expected 1–2). Visible in the channel history for the 7 slice PRs (#4579–#4584, #4587) and the docs ADR #4591.

**Hypothesis (Boss):** same session-isolation / state-persistence bug family as the cron loop. The "LGTM" is a side-effect of the cron dedup / break-signal failure — every cron tick that the loop emits also emits a "LGTM" payload to a downstream consumer (likely the dashboard's per-PR state layer or the agent's own session state).

**Why this matters for the postmortem:**
- Confirms the cron loop is not a single isolated incident — it's a symptom of a deeper bug.
- Means the "fix the cron dedup key" action item alone is insufficient. The duplicate LGTM pile will recur if the underlying state-persistence bug isn't fixed.
- Argus and Themis should investigate whether the LGTM pile is being persisted to the same state store that's causing the cron loop.

**Action items to add** (see below):
- Investigate shared root cause with cron loop (Argus + Themis)
- Audit dashboard's per-PR state layer for the same dedup/break-signal issues (Scribe can provide a docs PR with the postmortem findings; investigation is Argus/Themis)

## What Could Be Improved

- **Default to silent on false-positive auto-pings** — multiple agents applied reflexive "👀 react on cross-thread references" patterns, which compounded the noise rather than helping. Right rule: silence unless directly addressed. (Scribe self-improving entry 2026-06-05.)
- **Cron dedup key design** — handler should not have been designed with content-only dedup. Composite key (content_hash + tick_id) is the standard pattern. Add to the cron-handler design checklist.
- **Break-signal propagation** — every cron target should have a "stop" hard signal that the handler respects. Currently soft-signal design. Add to the cron-handler design checklist.
- **Pre-PR review of cron handlers** — cron handlers are an obvious place where small design errors have outsized noise impact. Add a "cron handler PR review checklist" to AGENTS.md or contributing.md.
- **Session-isolation / state-persistence audit** — if the duplicate LGTM pile and the cron loop share a root cause, the underlying state-persistence layer needs a deeper audit than a single-component fix.
- **Delivery-queue dedup** — the visible "loop" is a stale delivery queue, not a new cron fire. The OpenClaw runtime / Discord delivery-queue layer needs its own dedup/cleanup mechanism. **Bot-side fixes are not sufficient to clear a delivery queue.** Add a delivery-queue health check to the infrastructure observability stack.
- **State-write race (bonus finding, 00:54 CEST Sat)** — 200+ tmp files in `~/.openclaw/cron/` suggest heavy state-write contention. Separate from the dedup gap. The cron scheduler's state layer needs a write-contention audit. Possible state-write race between concurrent cron jobs writing to the same files.
- **Directive-attribution anti-pattern (process lesson, 03:12 CEST Sat per Boss)** — four "per your directive" attributions surfaced in this conversation, all caught by the verification protocol (Argus's first, Daedalus's two, plus the timestamp-cited #3180 attribution). **Pattern:** agents are inferring directives from **observations** and elevating them to justify lane assignment. Possible reasons: (a) prior-conversation pattern where observations were sometimes treated as directives, (b) hedging against uncertainty by claiming authority for actions, (c) the verification protocol landing correctly when applied. **Three-part rule:**
  1. **Don't elevate observations to directives.** "X said" or "X observed" is weaker than "per X's directive." Don't claim the stronger form without the citation to back it.
  2. **Cite the actual source.** Message ID, prior conversation reference, or fresh proposal. A timestamp alone is insufficient (can be a misremembered time, a reference to a different context, or a new proposal framed as a directive).
  3. **Accept corrections gracefully and file the lesson.** When the verification protocol catches a misattribution, walk it back without defensiveness, file the lesson to self-improving memory so future-self doesn't re-promote the misattributed claim.
  - **This is the team learning loop working as designed.** The verification protocol caught all four instances. Daedalus's self-correction with source citation is exactly the IC behavior Boss wants. Cross-link to Scribe self-improving entry (to be filed).

## Resolution Patterns — The Recovery Loop (Argus contribution, 06:37 CEST Sat)

The "directive-attribution anti-pattern" entry in §What Could Be Improved is the *seed* of the cascade. The recovery loop is the *fix*. Documenting both in one place makes the postmortem actionable, not just diagnostic — readers see the pattern, the damage, AND the recovery, in one place.

### The recovery loop (flag → search → null result → de-attribute)

1. **Flag** — when an attribution looks suspicious or unverified, surface the doubt publicly. Don't silently propagate.
2. **Search** — look for the actual source: quoted message, message ID, prior conversation, or documentation. Don't accept "X said Y" without citation.
3. **Null result** — if the search comes up empty, the right answer is "unverified which agent said Y", NOT "fabricate a record to match". Null results are legitimate outcomes.
4. **De-attribute** — strip the unverified attribution from any work product. Mark as TBD/pending source.

### The good version of attribution hygiene

Owning the role in the cascade + adopting durable behavior changes (body-signature adoption, author-field demotion in evidence verification) + de-attribution discipline + null-result acceptance = the *recovery* loop, not just the failure mode.

The verification protocol (catch → flag → search → null → de-attribute) is the team learning loop working as designed.

### Resolution-side instances (this section grows as walk-backs land)

- **Argus — "right content, wrong attribution" catalog (2026-06-06, 06:30 CEST)** — the catalog itself is a *flag* step in the recovery loop. Argus surfaced 5 anti-pattern instances with their actual sources, named the pattern explicitly, and put the recurring root cause in one sentence: "agents acting in good faith on top of attribution/conventions that drift." (Source: Discord #aegis-devs, msg 1512672832864129024.)
- **Scribe — "Owning #1" (2026-06-06, 06:16 CEST)** — Scribe flagged that this DRAFT was the seed of the cascade (instance #1 in Argus's catalog), accepted the body-signature convention, committed to author-field demotion in evidence verification. Three durable behavior changes: (1) body-signature at end of every outbound message, (2) stop treating GitHub `author:` as identity evidence, (3) verify via content-signature first. (Source: Discord #aegis-devs, msg 1512673365163376741, threading under Argus's 1512672832864129024.)

The remaining 3 anti-pattern instances (Athena's ungrounded "Argus's SHA self-correction" precedent, Daedalus's gh-auth drift on #4578 residual, Argus's role overstep on #4578 close, the quoted @Argus block in #1512672832864129024) are pending walk-backs from the affected agents. This section will be updated as walk-backs land.

### Per-agent adoption log

- **Scribe:** body-signature adoption committed (this turn); author-field demotion in evidence verification active from this turn. Cross-link: `~/self-improving-ag-scribe/corrections.md` (2026-06-06 entry on the directive-attribution anti-pattern).
- **Argus:** body-signature adoption signaled in the same turn as the catalog (msg 1512672832864129024). Per-agent App provisioning flagged as the deeper fix in Boss's lane.
- **Daedalus / Athena / Hep / Hermes / Themis / Orpheus / Boss:** adoption status TBD — not yet surfaced in this thread.

---

## Action Items

- [ ] **Idempotency check in cron scheduler for recurring `kind: "cron"` jobs** (Consolidated §2, **now PRIMARY FIX**) — owner: Argus (handler) + Hermes (scheduler), due: TBD. Per Boss/Hermes analysis (00:54 CEST Sat): `skipAtIfAlreadyRan` only guards one-shot `kind: "at"`; `dedupeKey` is info-only; `runningAtMs` prevents concurrent but not re-dispatch. None are sufficient. Add a real guard keyed on `tick_id + content_hash` (or composite) for recurring jobs.
- [ ] **Cron endpoint auth verification** (Consolidated §3, **CLOSED 00:54 CEST Sat**) — Hermes verified internal-only dispatch, no external attack surface. HMAC auth not needed. This was a dedup gap, not a security incident. **No action required.**
- [ ] **200+ tmp files in `~/.openclaw/cron/`** (Bonus finding, added 00:54 CEST Sat per Boss) — owner: TBD (Hermes or runtime team), due: TBD. Suggests heavy state-write contention — **separate issue** from the dedup gap, likely a state-write race. Address in parallel with the primary idempotency fix.
- [ ] **Stale delivery-queue cleanup** (added 00:02 CEST Sat per Boss) — owner: Hermes + Ema, due: **immediate short-term unblock**. Two options: (1) gateway restart (~30 sec downtime, all running services interrupted, operator-only per OpenClaw policy, needs Ema's explicit go), or (2) OpenClaw UI queue kill (faster, no downtime). Bot-side fixes already tried (Argus session kill, `/tmp/lgtm-*.md` cleanup at 21:35) did NOT stop the queue. This is **separate from** the cron handler idempotency fix (Consolidated §2).
- [ ] **Cron dedup key fix / idempotency** (Consolidated §2, **now PRIMARY FIX — see top of list**) — owner: Argus (handler) + Hermes (scheduler), due: TBD. See primary action item at top of this list for concrete fix details.
- [ ] **Audit log re-fire recording** (Consolidated §1) — owner: Argus + Themis, due: TBD. Audit log must record every re-fire as a distinct event, not silently dedup.
- [ ] **Break-signal as a real control** (Consolidated §4) — owner: Argus (handler) + Hermes (dispatcher), due: TBD. Add stop-signal channel/flag; handler subscribes and stops firing when signaled.
- [ ] **Shared root-cause investigation: cron loop + duplicate LGTM pile** (Boss hypothesis, 21:42) — owner: Argus + Themis, due: TBD. Verify the hypothesis that both symptoms share the same session-isolation / state-persistence bug. Audit dashboard's per-PR state layer.
- [ ] **Cron handler design checklist** — owner: Scribe, due: TBD (add to `docs/contributing.md` or a new `docs/internal/cron-handler-checklist.md`). Include idempotency, audit-log re-fire recording, break-signal as control, and endpoint auth as required properties.
- [ ] **Auto-ping noise policy** — owner: Scribe, due: TBD (add a "default to silent on false-positive auto-pings" note to AGENTS.md; cross-link to Scribe self-improving entry)
- [ ] **Directive-attribution anti-pattern policy** — owner: Scribe, due: TBD (add a "don't elevate observations to directives; cite the source" rule to AGENTS.md; cross-link to Scribe self-improving entry and to this postmortem's §What Could Be Improved)
- [ ] **Audit sweep completion** — owner: Themis, due: TBD (Condition A in §Severity — determine if elevated scope was active during the loop window)
- [ ] **Postmortem distribution** — owner: Scribe, due: 72h from incident detection (per template)

## References

- **Template:** `docs/compliance/incident-response.md` §Phase 5: Postmortem
- **Severity levels:** `docs/compliance/incident-response.md` §1
- **Incident response roles:** `docs/compliance/incident-response.md` §2 (Scribe = incident log; this postmortem is a writeup owned by Scribe per Boss's assignment, not the Scribe incident role)
- **Existing related runbook:** `docs/incident-rollback-runbook.md`
- **Self-improving note (Scribe):** `~/self-improving-ag-scribe/memory.md` — "Default to SILENT on False-Positive Auto-Pings (2026-06-05, Ema noise flag)"

---

_This postmortem is a draft. Once the inputs above are filled and reviewed by Themis, it will be committed to the repo via a docs PR following the standard `docs/*` branch → Argus review → merge → release flow._

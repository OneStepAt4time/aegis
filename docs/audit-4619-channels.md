# src/channels/ Audit — Issue #4619

**Author:** Hephaestus (`<hephaestus@aegis.dev>`)
**Branch:** `audit/4619-channels`
**Date:** 2026-06-09
**Scope:** `src/channels/**` (3,861 lines across 19 files (18 source files + 1 barrel: channels/index.ts)) — quality review, coverage analysis, security/error-handling findings, refactor opportunities.
**DoD items addressed in this report:** #1 (audit report).

---

## 1. Executive summary

The issue body claims `src/channels/` has **3,861 lines with 0% coverage**. The
line count is accurate; the coverage claim is **out of date**. The actual
state, measured on `develop` @ `559fa663` (2026-06-09 05:08 UTC):

- **Aggregate `src/channels/` line coverage: ~48%** (weighted by file size).
- **Six files are well-tested (≥ 80% lines):** `email.ts` (92%),
  `manager.ts` (91%), `webhook.ts` (91%), `slack.ts` (90%),
  `telegram-style.ts` (98%), `topic-persistence.ts` (81%),
  `telegram-topic-lifecycle.ts` (67%).
- **Six files are critically under-tested (≤ 10% lines):**
  `telegram/telegram-message-handler.ts` (0%),
  `telegram/telegram-status-handler.ts` (0%),
  `telegram/telegram-polling.ts` (1%),
  `telegram/message-formatter.ts` (5%),
  `telegram/telegram-sender.ts` (7%),
  `telegram/formatter.ts` (20%).
- The `ChannelManager` **circuit breaker is already well-covered** by
  `src/__tests__/channels/manager.test.ts` (478 lines, 25+ tests). 4xx-vs-5xx
  classification, FAILURE_THRESHOLD trip, network-error trip, success-resets-
  failure-count, and mixed-error behavior are all asserted. The only
  remaining gap is **cooldown re-enable** (a recovery test that advances the
  clock past `COOLDOWN_MS`).
- No critical security defects found. Bot-token redaction, SSRF protection,
  and HTML escaping are implemented and consistently used. See §4 for the
  short list of low-risk items.

**Bottom line:** this is a _focused coverage-and-quality_ ticket, not a
fire-fighting ticket. The highest-value work is **(a)** tests for the six
under-tested telegram subdirectory files, **(b)** a `cooldown re-enable`
test for the circuit breaker, and **(c)** a moderate refactor of
`telegram/index.ts` (405 lines, orchestrator + 5 delegate methods +
`tgApi` + 4 lifecycle hooks).

---

## 2. File-by-file coverage (develop @ 559fa663)

Source: `coverage/lcov.info` from `npx vitest run --coverage` (root run).
Thresholds: lines 65% / branches 60% / functions 65% (vitest.config.ts:18).
**Bold** = below the 65% line threshold.

| File                                   | Lines             | Funcs        | Branches    | Risk         |
| -------------------------------------- | ----------------- | ------------ | ----------- | ------------ |
| `email.ts`                             | 69/75 (**92%**)   | 17/17 (100%) | 26/38 (68%) | low          |
| `index.ts` (barrel)                    | 0/0 (n/a)         | 0/0          | 0/0         | n/a          |
| `manager.ts`                           | 49/54 (**91%**)   | 16/19 (84%)  | 18/24 (75%) | low — see §3 |
| `slack.ts`                             | 63/70 (**90%**)   | 17/17 (100%) | 34/42 (81%) | low          |
| `telegram-style.ts`                    | 62/63 (**98%**)   | 17/18 (94%)  | 33/46 (72%) | low          |
| `telegram.ts` (re-export)              | 0/0 (n/a)         | 0/0          | 0/0         | n/a          |
| `telegram/formatter.ts`                | **21/103 (20%)**  | 5/13 (38%)   | 12/63 (19%) | **medium**   |
| `telegram/index.ts`                    | **51/133 (38%)**  | 5/18 (28%)   | 10/64 (16%) | **high**     |
| `telegram/message-formatter.ts`        | **7/152 (5%)**    | 1/16 (6%)    | 0/133 (0%)  | **high**     |
| `telegram/telegram-message-handler.ts` | **0/81 (0%)**     | 0/1 (0%)     | 0/108 (0%)  | **high**     |
| `telegram/telegram-polling.ts`         | **1/126 (1%)**    | 0/3 (0%)     | 0/127 (0%)  | **high**     |
| `telegram/telegram-sender.ts`          | **10/135 (7%)**   | 2/17 (12%)   | 6/72 (8%)   | **high**     |
| `telegram/telegram-status-handler.ts`  | **0/63 (0%)**     | 0/1 (0%)     | 0/40 (0%)   | **high**     |
| `telegram/telegram-topic-lifecycle.ts` | 55/82 (**67%**)   | 7/9 (78%)    | 22/49 (45%) | medium       |
| `telegram/topic-persistence.ts`        | 22/27 (**81%**)   | 3/4 (75%)    | 14/22 (64%) | low          |
| `telegram/session-topic-types.ts`      | 0/0 (types only)  | 0/0          | 0/0         | n/a          |
| `telegram/types.ts`                    | 0/0 (types only)  | 0/0          | 0/0         | n/a          |
| `webhook.ts`                           | 116/127 (**91%**) | 24/27 (89%)  | 54/63 (86%) | low          |

**Interpretation.** The aggregate coverage is dragged down by the **6
under-tested files in `telegram/`**. These files are the entire surface area
where a user can talk to Aegis via Telegram (which is the highest-traffic
bidirectional channel). The risk of regressions there is high. The remaining
files are at or above the 65% floor and the existing tests cover the
high-stakes behaviors (retries, breaker, allowlists, SSRF).

---

## 3. Code quality findings

### 3.1 `telegram/index.ts` is a god module (405 lines)

`TelegramChannel` is responsible for:

1. Bot API transport (`tgApi`, rate-limit tracking, retry) — lines 152-194
2. Lifecycle (init, destroy, poll-loop start, sweep) — lines 200-240
3. Event handlers (onSessionCreated, onSessionEnded, onMessage, onStatusChange) — lines 240-340
4. State tracking (`trackSuccess`, `trackFailure`, `getHealth`) — lines 350-380
5. Delegate methods (5 of them, all 1-liners) — lines 380-405
6. `redactError` — lines 395-405
7. Public API (`getTopicIdForSession`, `getHealth`) — lines 343-355

**Refactor recommendation:** split into `telegram/api.ts` (transport),
`telegram/health.ts` (state tracking), and a thin `TelegramChannel` shell
in `telegram/index.ts` that composes them. The 5 delegate methods
(`sendStyled`, `startTopicCleanupSweep`, `scheduleTopicCleanup`,
`runTopicCleanup`, `redactError`) are kept as instance methods _for
backward compat with tests that spy on them_ — they could move to free
functions with no observable difference to the test suite. The
`test-spy-compat` constraint is real (it would force a test rewrite) — see
§6 PR-splitting notes.

### 3.2 `tgApi` is a single 40-line function with 3 concerns

`telegram/index.ts:152-194` mixes: (a) 429 rate-limit waiting, (b) the actual
fetch + JSON parse, and (c) generic retry/backoff. The retry/backoff portion
is also reinvented — `webhook.ts` has `WebhookChannel.backoff()` with the
same semantics. **Recommendation:** extract to `telegram/api.ts` with a
single function signature `tgApi(method, body, opts?)` and a small helper
for the 429 path.

### 3.3 Handler functions swallow callback errors

In `telegram/telegram-polling.ts:34`, the poll-loop catches every error and
just logs + backs off. This is intentional (long-poll should never crash
the bridge) but the only signal is a `log.error` line. A test that asserts
the backoff timing and the `pollBackoffMs` doubling would lock the
recovery behavior. (See §5.3.)

### 3.4 Dead-code surface: `TopicPersistence` re-export

`channels/telegram.ts` (3 lines) is a compatibility barrel re-exporting
`telegram/index.js`. It's still imported by some old code paths but
`channels/index.ts` already exports the same surface. **Recommendation:**
search-and-grep for `from '../channels/telegram'` / `from './telegram'`
to confirm no consumer actually needs the barrel, then delete it.

### 3.5 `SessionEvent` enum has 24 variants but most are tested only via mocks

`types.ts:18-42` declares 24 events. The `manager.test.ts` mock channel
implements all four optional handlers (`onSessionCreated`, `onSessionEnded`,
`onMessage`, `onStatusChange`) — the actual _event fanout_ test in
`manager.test.ts:106-167` exercises only 4 of 24 variants
(`session.created`, `session.ended`, `message.user`, `status.idle`).
The other 20 (`message.thinking`, `message.tool_use`, `swarm.*`,
`status.stall`, `status.question`, `status.plan`, `session.awaiting_approval`,
etc.) are not directly tested. **Recommendation:** add a parameterized
test in `manager.test.ts` that asserts each of the 24 events is fanned
out to all subscribed channels without discrimination. Low cost, high
documentation value.

---

## 4. Security findings

### 4.1 Bot token redaction — PASS, with one subtle gap

`telegram/index.ts:395-405` defines `redactError(err)` that replaces the
bot token with `REDACTED` in any string. **Used consistently** in 5 of 5
error-logging sites I checked:

- `telegram-sender.ts:89` — `sendStyledFailed`
- `telegram-sender.ts:216` — `sendFailed`
- `telegram/index.ts:365` — `trackFailure` (used for `lastErrorMessage`)
- `telegram-polling.ts:34` — `pollError`
- `telegram-topic-lifecycle.ts:129` — `topicCleanupFailed`

**Gap:** when `tgApi` (lines 152-194) throws, the error message is just
`Telegram API <method>: <data.description>` — `data.description` is from
Telegram's response, not from our code, so the token is **not** in the
string. However, the `redactError` is **not** called on the thrown Error
itself before the caller logs it. A future caller that logs a raw
`tgApi` error with `String(e)` could leak. **Recommendation (low
priority):** wrap the `throw new Error(...)` at line 187 with
`throw this.redactError(...)` so the contract is enforced at the source.
A unit test that imports a fake token in `data.description` would lock
this behavior.

### 4.2 Telegram allowlist — PASS

`telegram/telegram-polling.ts:65-87` rejects messages with an empty
allowlist (security default) and with a non-allowed `from.id` (logs
and sends a warning into the topic). Callback queries get the same
treatment at lines 130-150. **Tested by `tests/`?** No. **Recommendation:**
add tests for both message-rejection and callback-rejection paths. See
§5.4.

### 4.3 SSRF protection on webhooks — PASS

`webhook.ts:46-47` imports `validateWebhookUrl`, `resolveAndCheckIp`,
`buildConnectionUrl` from `../ssrf.js`. Every outbound fetch at
`webhook.ts:262-290` resolves DNS, validates the IP, and constructs a
connection URL with the resolved IP + a `Host` header. This is
defense-in-depth against DNS rebinding. **Tested by:**
`src/__tests__/webhook-ssrf.test.ts` (separate file). **Pass.**

### 4.4 Email HTML escaping — PASS

`email.ts:212-220` escapes `&`, `<`, `>`, `"` before interpolating
`payload.session.name`, `payload.session.id`, `payload.session.workDir`,
`payload.detail` into the HTML template. **Note:** the apostrophe is
NOT escaped (HTML attribute values are quoted with `"` here, so this is
fine for the current template). **Pass.**

### 4.5 Slack blocks construction — PASS

`slack.ts:131-180` builds Slack blocks with markdown that contains
user-controlled `payload.detail`. Slack's own markdown parser
neutralizes HTML — the relevant risk is broken layout, not XSS. **Pass.**

### 4.6 No injection risk from `data.description` on 429

`tgApi` reads `data.parameters.retry_after` directly from the JSON
response and uses it as a sleep duration (`retryAfter * 1000 + 500`).
A malicious or buggy Telegram response could return `retry_after: 99999`
and cause a 27-hour sleep. **Recommendation (low):** clamp
`retry_after` to a sane max (e.g., 60 seconds) before applying. Add a
test that asserts a 99999 response sleeps at most 60s.

### 4.7 `payload.session.workDir` exposure

`email.ts:189` and `slack.ts:158` both interpolate
`payload.session.workDir` into HTML/markdown. `webhook.ts:189-200`
explicitly redacts it (`'[REDACTED]'`). **Inconsistency:** email and
slack don't redact. Workdir is a filesystem path — usually not secret,
but on a shared host it can leak usernames. **Recommendation:** redact
in email/slack the same way webhook does, or define a single
`redactSession()` helper. Owner: Scribe (docs) + Hephaestus (impl).

---

## 5. Test recommendations (for PR2)

### 5.1 Circuit breaker — `cooldown re-enable` test (1 test, ~30 lines)

The existing `src/__tests__/channels/manager.test.ts` covers trip behavior
but not recovery. Add to the `circuit breaker` describe block:

```ts
it('re-enables channel after COOLDOWN_MS expires', async () => {
  vi.useFakeTimers();
  const manager = new ChannelManager();
  const { channel: ch, onSessionCreated } = createMockChannel('telegram');
  onSessionCreated.mockRejectedValue(new RetriableError('HTTP 503'));
  manager.register(ch);

  for (let i = 0; i < ChannelManager.FAILURE_THRESHOLD; i++) {
    await manager.sessionCreated(createPayload('session.created'));
  }
  // Channel is now disabled — call during cooldown is skipped
  await manager.sessionCreated(createPayload('session.created'));
  expect(onSessionCreated).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD);

  // Advance past cooldown
  vi.advanceTimersByTime(ChannelManager.COOLDOWN_MS + 1);

  // Channel is re-enabled — call goes through
  onSessionCreated.mockResolvedValueOnce(undefined);
  await manager.sessionCreated(createPayload('session.created'));
  expect(onSessionCreated).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD + 1);
  vi.useRealTimers();
});
```

### 5.2 Parameterized event-fanout test (1 test, ~40 lines)

Add to `src/__tests__/channels/manager.test.ts`:

```ts
it.each([
  'session.created',
  'session.ended',
  'session.awaiting_approval',
  'session.approved',
  'session.rejected',
  'message.user',
  'message.assistant',
  'message.thinking',
  'message.tool_use',
  'message.tool_result',
  'status.idle',
  'status.working',
  'status.permission',
  'status.question',
  'status.plan',
  'status.stall',
  'status.dead',
  'status.stopped',
  'status.error',
  'status.rate_limited',
  'status.permission_timeout',
  'status.recovered',
  'status.context_warning',
  'swarm.teammate_spawned',
  'swarm.teammate_finished',
] as SessionEvent[])('fans out %s to subscribed channels', async event => {
  // 1-channel manager, assert onMessage/onStatusChange/onSessionCreated
  // /onSessionEnded receives the payload based on event prefix
});
```

### 5.3 Telegram long-poll backoff test (1 file, ~80 lines)

`src/__tests__/channels/telegram-polling.test.ts` (new). Mock `ctx.tgApi`
to throw N times, then succeed. Assert:

- `pollBackoffMs` doubles (1s → 2s → 4s → ... → capped at 30s)
- `ctx.polling = false` stops the loop
- Successful response resets `pollBackoffMs` to 1000

This file should be **largest** of the new tests because the polling
loop is the most failure-prone piece of the Telegram integration.

### 5.4 Telegram allowlist tests (1 file, ~120 lines)

`src/__tests__/channels/telegram-allowlist.test.ts` (new). Mock a
`TelegramChannelInternals` with an `allowedUserIds` list, drive
`handleUpdate` and the callback-query path, assert:

- User not in allowlist → `ctx.onInbound` NOT called; warning logged
- Empty allowlist → all users rejected; "Telegram access disabled"
  message sent to topic
- User in allowlist → message routed to correct session's `onInbound`

### 5.5 Per-channel happy-path smoke tests (4 files, ~60 lines each)

The issue's DoD #3 lists these explicitly. They are RED-GREEN tests that
verify the contract is intact, not exhaustive unit tests:

- `src/__tests__/channels/telegram-sender.test.ts` — `sendStyled` with
  a mocked `tgApi`, assert message body matches the styled input.
- `src/__tests__/channels/webhook-delivery-happy.test.ts` — `WebhookChannel`
  with one endpoint, mock `fetch`, assert payload structure + headers.
  (Note: there's already `webhook-delivery-tracking.test.ts` and
  `webhook-retry.test.ts` — this would be a separate, simpler smoke
  test.)
- `src/__tests__/channels/slack-smoke.test.ts` — `SlackChannel.fire()`
  with mocked fetch, assert blocks contain the right `text` and `channel`.
- `src/__tests__/channels/email-smoke.test.ts` — `EmailChannel.send()`
  with a mocked `Transporter`, assert `mailOptions.to` and `subject`
  match expectations.

### 5.6 `redactError` regression test (1 file, ~30 lines)

`src/__tests__/channels/telegram-redact.test.ts` (new). Three cases:

- Token present in error string → redacted in output
- Token absent → returned unchanged
- Error is `Error` instance containing token → new Error with redacted
  message + literal "[stack redacted]" suffix

### 5.7 Test ordering: PR2 work split recommendation

Per AGENTS.md (no file > 500 lines), split PR2 into 2 PRs:

- **PR2a (low-risk tests):** §5.1 + §5.2 + §5.6 (cooldown, fanout-param,
  redact). All append to `manager.test.ts` (existing file) or a small
  new file. ~120 lines total.
- **PR2b (telegram-allowlist + smoke):** §5.3 + §5.4 + §5.5. ~360 lines
  across 5 new files. Larger but each file is small and focused.

---

## 6. Out-of-scope (per #4619 body)

Confirmed not addressed in this audit or any planned PR:

- Adding new channel types (Discord, MS Teams, etc.) — separate epic
- Refactoring the `Channel` interface or `SessionEvent` enum — separate
- Dashboard changes — none
- Webhook authentication/signing — security lane (Themis)
- Channel throughput benchmarks — covered by `scripts/load-test.ts`
- Telemetry/metering — separate epic

---

## 7. Process notes for Argus review

This report is the first of 1–2 PRs the ticket allows. The second PR
(test coverage) is tracked separately; this PR is docs-only. No code
changes, no test changes, no new dependencies. `npm run lint` and
`npm run typecheck` not required (no source touched), but a `git grep
audit-4619` to confirm no stale references before merge is the standard
hygiene check (per AGENTS.md).

Lane: backend. Reviewer: Argus. Out-of-scope deltas: none (the report
adds findings but does not change behavior).

---

## 8. Follow-up issues to file at audit-report merge

If Argus approves this report, the following tickets should be filed at
merge time (one issue per finding, not bundled — keeps the DoR clean):

1. **Circuit-breaker cooldown re-enable test** — DoD #2 has 1 remaining
   test. Small, no scope creep.
2. **Telegram subdirectory coverage to 50%** — combines the
   6 under-tested files into one refactor. Larger, may need to be split
   per file at DoR.
3. **`telegram/index.ts` split (god module)** — refactor of §3.1, scope
   limited to transport + state-tracking extraction.
4. **`tgApi` retry_after clamp (60s max)** — §4.6, defensive.
5. **`redactError` apply in `tgApi` throws** — §4.1, defensive.
6. **Email/Slack workdir redaction** — §4.7, cross-channel
   consistency.

None of these are P0. The highest-priority item is #2 (the 6
under-tested telegram files), which is the bulk of the coverage work
the issue DoD #2-#4 describe.

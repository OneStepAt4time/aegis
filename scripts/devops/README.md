# Cron Timeout Override Shim

**Issue:** [#4808](https://github.com/OneStepAt4time/aegis/issues/4808) — Lane B of [#4755](https://github.com/OneStepAt4time/aegis/issues/4755).

## Problem

Non-trivial `isolated agentTurn` cron payloads time out per-provider during
the OpenClaw sequential fallback chain. Observed: 5 providers × ~2.5min ≈
13min exceeds each provider's per-call timeout for complex multi-step
workloads (release-please pre-flight). The cron fails with
`FallbackSummaryError: All models failed (5)`.

## Why this script exists

The root fix is upstream ([openclaw/openclaw#95408](https://github.com/openclaw/openclaw/issues/95408) —
per-agent `model.requestTimeoutSeconds`, Lane C, Hermes). Until that
merges + ships + this host upgrades, we need a workaround on the Aegis
side.

The workaround: bump `models.providers.<provider>.timeoutSeconds` for the
3 unique providers used by `ag-hermes` (the agent that runs the
release-please cron). OpenClaw 2026.5.7 reads this knob at
`model-f6pqrkVH.js:348` (`applyConfiguredProviderOverrides`).

This script applies the override idempotently.

## Why it's safe (global per-provider, not per-agent)

The OpenClaw 2026.5.7 schema only honors `timeoutSeconds` at the
`models.providers.<provider>` level, not per-agent. Setting it raises the
ceiling for every agent that uses those providers. This is acceptable:

- **Simple-payload crons** (watchdog, qa-scan, sentinel) complete in ~30s,
  well under any reasonable `timeoutSeconds` value. The bump is invisible.
- **Outer cron-level bound** (`payload.timeoutSeconds`) is unchanged.
  Each cron still has its own outer timeout (e.g., 120s for watchdog,
  900s for release-please). Bumping the inner per-provider timeout
  doesn't extend those.
- **Cost ceiling** is the same — the LLM call still pays per token, just
  gets more wall-clock before giving up.

The shim is documented as a workaround. Once Lane C merges + ships +
this host upgrades, the override can be reverted by deleting the
`timeoutSeconds` field from each provider in `~/.openclaw/openclaw.json`.

## Usage

```bash
# DRY-RUN (default) — show what would change
bash scripts/devops/add-cron-timeout-overrides.sh

# Apply the default 600s (10min) override
APPLY=1 bash scripts/devops/add-cron-timeout-overrides.sh

# Apply a custom timeout
TIMEOUT_SECONDS=900 APPLY=1 bash scripts/devops/add-cron-timeout-overrides.sh

# Apply to a subset of providers
TARGET_PROVIDERS="minimax-portal zai" APPLY=1 bash scripts/devops/add-cron-timeout-overrides.sh

# Non-default install path
OPENCLAW_CONFIG=/path/to/openclaw.json APPLY=1 bash scripts/devops/add-cron-timeout-overrides.sh
```

Default timeout: **600s (10min)** — 4× the observed ~2.5min per-provider
ceiling, giving headroom for ~2× LLM round-trip variance.

## Re-enabling the release-please cron

After applying the override, the `ad1ab50a-dba8-40e2-a3de-ca2d2d09dba5`
cron (release-please dispatch) can be re-enabled. The current state has
it disabled with `sessionTarget: "session:agent:ag-hermes:..."` (named
session, from Hephaestus's prior failed workaround on the named-session
lock-in bug).

The cron config update is manual at the `~/.openclaw/cron/jobs.json`
level. Two changes required:

1. Set `enabled: true`
2. Change `sessionTarget` back to `"isolated"`
3. Update the prompt to a current release-please dispatch (the current
   one references issue #4708 and a 2026-06-16 memory file)

The cron daemon picks up the change on its next read cycle (< 60s).

## Restart the OpenClaw gateway

The new `timeoutSeconds` takes effect on the next gateway reload. To
pick up immediately:

```bash
openclaw gateway restart
```

Then trigger one manual isolated agentTurn run on `ad1ab50a` to verify
the new ceiling holds.

## Tests

`scripts/devops/__tests__/add-cron-timeout-overrides.test.ts` covers:

1. DRY-RUN does not modify the config
2. APPLY=1 sets `timeoutSeconds` on each target provider
3. `TIMEOUT_SECONDS` env var overrides the default
4. Idempotency (re-running is a no-op)
5. Skip semantics (providers already at-or-above target)
6. Scope (`TARGET_PROVIDERS` env var)
7. Error paths (missing config, invalid timeout, malformed config)
8. Partial success (missing target provider doesn't abort other updates)

Run with:

```bash
npx vitest run scripts/devops/__tests__/add-cron-timeout-overrides.test.ts
```

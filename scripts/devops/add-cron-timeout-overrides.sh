#!/usr/bin/env bash
# scripts/devops/add-cron-timeout-overrides.sh
#
# Apply a per-provider `timeoutSeconds` override to the OpenClaw config so
# non-trivial `isolated agentTurn` cron payloads don't time out per-provider
# during the sequential fallback chain.
#
# Background — #4808 (Lane B of #4755, 2026-06-23): the release-please
# dispatch cron `ad1ab50a-dba8-40e2-a3de-ca2d2d09dba5` (referred to in the
# issue body as `dbe0ed03`, the leading-prefix nickname) was failing with
# `FallbackSummaryError: All models failed (5)` because each provider in
# the `ag-hermes` fallback chain timed out at ~2.5min before the LLM call
# could complete for the complex release-please pre-flight payload.
#
# The upstream fix is `openclaw/openclaw#95408` (per-agent
# `model.requestTimeoutSeconds`, Lane C, Hermes). This script implements
# the aegis-side shim (Lane B) by raising `models.providers.<provider>.
# timeoutSeconds` for the 3 unique providers used by `ag-hermes`'s
# fallback chain: `minimax-portal`, `kimi`, `zai`. The OpenClaw 2026.5.7
# runtime reads this knob at `model-f6pqrkVH.js:348`
# (`applyConfiguredProviderOverrides`), so it takes effect on the next
# gateway reload without code changes.
#
# The change is global per-provider (not per-agent), which is acceptable
# because:
#   - simple-payload crons (watchdog, qa-scan) complete in ~30s, well under
#     any reasonable timeoutSeconds value
#   - the cron-level `payload.timeoutSeconds` is the OUTER bound for each
#     cron job; bumping per-provider timeoutSeconds doesn't extend those
#   - the upstream Lane C fix will replace this shim with a per-agent
#     knob once it merges; the shim is documented as a workaround
#
# Idempotent: re-running on an already-patched config is a no-op.
#
# Usage:
#   bash scripts/devops/add-cron-timeout-overrides.sh                            # DRY-RUN, default 600s
#   APPLY=1 bash scripts/devops/add-cron-timeout-overrides.sh                    # actually patch
#   TIMEOUT_SECONDS=900 APPLY=1 bash scripts/devops/add-cron-timeout-overrides.sh  # custom timeout
#   OPENCLAW_CONFIG=/path/to/openclaw.json bash ...                              # override config path
#
# Requires: jq for JSON parsing. No network. No OpenClaw gateway required
# at apply time — the cron daemon picks up the new config on its next
# reload cycle (typically < 60s).

set -euo pipefail

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------

# Default target providers — the 3 unique providers used by the `ag-hermes`
# agent's 5-model fallback chain (per ~/.openclaw/openclaw.json agents[].id
# == "ag-hermes" config):
#   primary:   minimax-portal/MiniMax-M3
#   fallbacks: kimi/kimi-code, zai/glm-5.1,
#              minimax-portal/MiniMax-M2.7-highspeed, zai/glm-5-turbo
# Override via TARGET_PROVIDERS env var (space-separated).
if [[ -n "${TARGET_PROVIDERS:-}" ]]; then
    # shellcheck disable=SC2206
    TARGET_PROVIDERS_ARR=( $TARGET_PROVIDERS )
else
    TARGET_PROVIDERS_ARR=(
        minimax-portal
        kimi
        zai
    )
fi

# Default timeout: 600s = 10min (4x the observed ~2.5min per-provider ceiling)
DEFAULT_TIMEOUT_SECONDS=600

# Override via TIMEOUT_SECONDS env var.
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-$DEFAULT_TIMEOUT_SECONDS}"

# Validate timeout is a positive integer
if ! [[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: TIMEOUT_SECONDS must be a positive integer (got: '$TIMEOUT_SECONDS')" >&2
    exit 2
fi

# OpenClaw config path. Default: ~/.openclaw/openclaw.json. Override via
# OPENCLAW_CONFIG env var (useful for testing or non-default installs).
OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

# DRY_RUN by default; set APPLY=1 to actually patch.
DRY_RUN=1
if [[ "${APPLY:-0}" == "1" ]]; then
    DRY_RUN=0
fi

# ----------------------------------------------------------------------------
# Preflight
# ----------------------------------------------------------------------------

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required for JSON parsing" >&2
    exit 2
fi

if [[ ! -f "$OPENCLAW_CONFIG" ]]; then
    echo "ERROR: OpenClaw config not found at: $OPENCLAW_CONFIG" >&2
    echo "Set OPENCLAW_CONFIG env var to the correct path." >&2
    exit 2
fi

# Sanity: the config must be valid JSON and have a models.providers map
if ! jq -e '.models.providers | type == "object"' "$OPENCLAW_CONFIG" >/dev/null 2>&1; then
    echo "ERROR: $OPENCLAW_CONFIG does not have a models.providers object" >&2
    echo "This doesn't look like an OpenClaw config." >&2
    exit 2
fi

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

echo "=== add-cron-timeout-overrides.sh ==="
echo "Config:           $OPENCLAW_CONFIG"
echo "Mode:             $([[ $DRY_RUN -eq 1 ]] && echo 'DRY-RUN (set APPLY=1 to patch)' || echo 'APPLY (config will be patched)')"
echo "TimeoutSeconds:   $TIMEOUT_SECONDS"
echo "Target providers: ${TARGET_PROVIDERS_ARR[*]}"
echo ""

UPDATED=0
SKIPPED=0
NOT_FOUND=0

for provider in "${TARGET_PROVIDERS_ARR[@]}"; do
    # Read current timeoutSeconds for this provider (null if unset)
    current=$(jq -r --arg p "$provider" '.models.providers[$p].timeoutSeconds // null' "$OPENCLAW_CONFIG")

    # Check provider exists in config
    provider_exists=$(jq -r --arg p "$provider" 'has("models") and (.models.providers[$p] != null)' "$OPENCLAW_CONFIG")

    if [[ "$provider_exists" != "true" ]]; then
        echo "❌ $provider — not found in models.providers"
        NOT_FOUND=$((NOT_FOUND + 1))
        continue
    fi

    # Idempotency: skip if already at or above target
    if [[ "$current" != "null" ]] && [[ "$current" -ge "$TIMEOUT_SECONDS" ]]; then
        echo "⏭️  $provider — already has timeoutSeconds=$current (>= $TIMEOUT_SECONDS)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
        action="would set"
        if [[ "$current" != "null" ]]; then
            action="would raise from $current to"
        fi
        echo "🔍 $provider — $action $TIMEOUT_SECONDS"
    else
        echo "✏️  $provider — setting timeoutSeconds=$TIMEOUT_SECONDS"
        # Atomic write via jq + mktemp. We avoid touching fields outside
        # the targeted provider entry.
        tmp=$(mktemp)
        jq --arg p "$provider" --argjson t "$TIMEOUT_SECONDS" \
            '.models.providers[$p].timeoutSeconds = $t' \
            "$OPENCLAW_CONFIG" > "$tmp"
        mv "$tmp" "$OPENCLAW_CONFIG"
    fi
    UPDATED=$((UPDATED + 1))
done

echo ""
echo "=== Summary ==="
echo "Would update / updated: $UPDATED"
echo "Already at or above target (skipped): $SKIPPED"
echo "Provider not found in config: $NOT_FOUND"
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
    echo "Re-run with APPLY=1 to actually patch:"
    echo "  APPLY=1 bash $0"
    echo ""
    echo "Or with a custom timeout:"
    echo "  TIMEOUT_SECONDS=900 APPLY=1 bash $0"
    echo ""
    echo "Or target a subset:"
    echo "  TARGET_PROVIDERS=\"minimax-portal zai\" APPLY=1 bash $0"
else
    echo "Done. The OpenClaw gateway will pick up the new config on its next"
    echo "reload cycle (typically < 60s, or restart with 'openclaw gateway restart')."
    echo ""
    echo "To verify, check the config directly:"
    echo "  jq '.models.providers | to_entries | map({provider: .key, timeoutSeconds: .value.timeoutSeconds})' $OPENCLAW_CONFIG"
fi

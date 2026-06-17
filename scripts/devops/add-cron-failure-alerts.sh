#!/usr/bin/env bash
# scripts/devops/add-cron-failure-alerts.sh
#
# Add a default `failureAlert` block to every OpenClaw cron job that doesn't
# have one. Idempotent: re-running this script is a no-op for crons that
# already have failureAlert configured.
#
# Background — #4754 (P0, 2026-06-17): release-please dispatch cron
# `dbe0ed03-195c-49ed-9c08-2daada930700` ran 4× between 07:49Z and 09:55Z
# UTC, all errored at the LLM layer (all 5 providers timed out). The cron
# had no `failureAlert` block configured, so no Discord notification fired.
# Boss found the failure via direct polling 5h+ later, not via channel
# notification. This script prevents that class of silent-failure gap from
# recurring.
#
# Policy: every cron ships with the default failureAlert below unless the
# owner has explicitly chosen a different target/cooldown. Per Scribe's
# OPERATIONAL-RULES.md § Cron defaults (2026-06-17 16:11 Rome, post-#4754):
#
#   Every cron ships with `failureAlert: { after: 1, cooldownMs: 900000,
#   channel: discord, mode: announce, to: channel:1490085572826501358 }`
#   by default — silent failure is the bug, not the symptom.
#
# Usage:
#   bash scripts/devops/add-cron-failure-alerts.sh          # apply defaults (dry-run by default)
#   APPLY=1 bash scripts/devops/add-cron-failure-alerts.sh  # actually update
#   ONLY_IDS="<id1> <id2>" bash scripts/devops/add-cron-failure-alerts.sh  # subset
#
# Requires: openclaw `cron` tool available; jq for JSON parsing.

set -euo pipefail

# ----------------------------------------------------------------------------
# Default failureAlert block (the policy — change with care)
# ----------------------------------------------------------------------------
# - after: 1 → fire on the FIRST error, not after N. Cron errors are rare;
#   we want to know immediately. (Per-cron override is fine if a particular
#   cron has noisy transient errors and a higher `after` makes sense —
#   edit the cron directly, don't change the default.)
# - cooldownMs: 900000 (15min) → don't spam if a cron retries multiple times
#   in quick succession. The cron's full retry window is ~50min for the
#   4-retry release-please pattern, so 15min cooldown will let the alert
#   re-fire if errors persist past the first window.
# - to: channel:1490085572826501358 → #aegis-devs (the ops channel).
# - accountId is intentionally not set; OpenClaw picks the default account
#   for the message destination, which is the ag-manudis bot for #aegis-devs.
DEFAULT_FAILURE_ALERT='{"after":1,"cooldownMs":900000,"channel":"discord","mode":"announce","to":"channel:1490085572826501358"}'

DRY_RUN=1
if [[ "${APPLY:-0}" == "1" ]]; then
    DRY_RUN=0
fi

# Cron jobs to update. Default: all enabled crons + dbe0ed03 (the one in
# #4754 scope). Override via ONLY_IDS env var (space-separated list of cron
# IDs).
if [[ -n "${ONLY_IDS:-}" ]]; then
    TARGET_IDS=( $ONLY_IDS )
else
    # The 7 cron IDs Boss listed in his 14:11 message + dbe0ed03 (the one in
    # the #4754 scope, currently disabled but in-scope to fix when re-armed).
    # Note: 23c0cc1d (Daedalus PHASE2-WATCH) is skipped — it has its own
    # custom failureAlert (after:10, cooldown:30min) tuned for noisy cadence.
    TARGET_IDS=(
        f12144bc-0d7c-4e2d-8cd1-80bea56f1d83  # Aegis health watchdog
        23f7c28d-fab9-49cf-90d1-a6a7e82a4ccc  # qa-scan (sentinel)
        53b04ebf-4a43-4c62-a99b-4dfba4290d6c  # Memory Dreaming Promotion
        b2954455-5bed-4b03-8dba-bdf5c56949c2  # orpheus-openspace-monthly-check
        4c87c092-1d03-41be-a053-033d6199a831  # Themis Phase 2 review T-15 (Thu)
        e18909d9-178f-4e55-99ea-6b66af3195fd  # Themis Phase 2 review T-15 (Mon)
        dbe0ed03-195c-49ed-9c08-2daada930700  # release-please dispatch (#4754)
    )
fi

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
echo "=== add-cron-failure-alerts.sh ==="
echo "Mode: $([[ $DRY_RUN -eq 1 ]] && echo 'DRY-RUN (set APPLY=1 to actually update)' || echo 'APPLY (cron update will be called)')"
echo "Target crons: ${#TARGET_IDS[@]}"
echo ""

# Get current state via the cron tool. We do this by calling the openclaw
# cron CLI through a small helper. Since the cron tool isn't a shell binary,
# we read jobs.json directly. Adjust the path if your openclaw install is
# elsewhere.
OPENCLAW_CRON_JOBS="${HOME}/.openclaw/cron/jobs.json"

if [[ ! -f "$OPENCLAW_CRON_JOBS" ]]; then
    echo "ERROR: $OPENCLAW_CRON_JOBS not found" >&2
    echo "Set OPENCLAW_CRON_JOBS env var to the correct path." >&2
    exit 2
fi

# Check jq
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required for JSON parsing" >&2
    exit 2
fi

UPDATED=0
SKIPPED=0
NOT_FOUND=0

for id in "${TARGET_IDS[@]}"; do
    # Read the current job entry
    current=$(jq -r --arg id "$id" '.jobs[] | select(.id == $id) | @json' "$OPENCLAW_CRON_JOBS" 2>/dev/null)

    if [[ -z "$current" || "$current" == "null" ]]; then
        echo "❌ $id — not found in jobs.json"
        NOT_FOUND=$((NOT_FOUND + 1))
        continue
    fi

    has_alert=$(echo "$current" | jq -r 'has("failureAlert")')

    if [[ "$has_alert" == "true" ]]; then
        # Show the existing failureAlert (truncated) for audit
        existing=$(echo "$current" | jq -c '.failureAlert')
        echo "⏭️  $id — already has failureAlert: $existing"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    name=$(echo "$current" | jq -r '.name // "(unnamed)"')
    # Cron tool treats null, false, and missing all as "not enabled".
    # Use explicit null check rather than jq's `// true` alternative.
    enabled=$(echo "$current" | jq -r 'if .enabled == null then "false" else (.enabled | tostring) end')

    if [[ $DRY_RUN -eq 1 ]]; then
        echo "🔍 $id ($name, enabled=$enabled) — would add failureAlert: $DEFAULT_FAILURE_ALERT"
    else
        echo "✏️  $id ($name, enabled=$enabled) — adding failureAlert"
        # Use jq to atomically update the file. We avoid the cron tool's PATCH
        # here so the script is fully self-contained (no dependency on the
        # OpenClaw gateway being reachable). The cron tool reads jobs.json on
        # its next read cycle.
        tmp=$(mktemp)
        jq --arg id "$id" --argjson alert "$DEFAULT_FAILURE_ALERT" \
            '(.jobs[] | select(.id == $id)).failureAlert = $alert' \
            "$OPENCLAW_CRON_JOBS" > "$tmp"
        mv "$tmp" "$OPENCLAW_CRON_JOBS"
    fi
    UPDATED=$((UPDATED + 1))
done

echo ""
echo "=== Summary ==="
echo "Would update / updated: $UPDATED"
echo "Already had failureAlert (skipped): $SKIPPED"
echo "Not found: $NOT_FOUND"
echo ""

if [[ $DRY_RUN -eq 1 ]]; then
    echo "Re-run with APPLY=1 to actually apply the change:"
    echo "  APPLY=1 bash $0"
    echo ""
    echo "Or apply to a subset:"
    echo "  ONLY_IDS=\"f12144bc-0d7c-4e2d-8cd1-80bea56f1d83\" APPLY=1 bash $0"
else
    echo "Done. The cron tool reads jobs.json on its next cycle (typically < 60s)."
    echo "To verify, list crons via the openclaw cron tool and look for the new failureAlert block."
fi

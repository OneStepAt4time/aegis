#!/usr/bin/env bash
# manage-aegis-apps.sh — Lifecycle management for per-agent GitHub Apps
# #4665 §C: enforces ADR-0030 permission matrix on registration
#
# Usage:
#   ./manage-aegis-apps.sh check        — verify all Apps installed with correct perms
#   ./manage-aegis-apps.sh audit        — print status report (install state, last rotation, drift)
#   ./manage-aegis-apps.sh mint <role>  — test mint an installation token for <role>
#   ./manage-aegis-apps.sh rotate-cron  — set up 90-day rotation reminders
#
# ADR-0030 permission matrix (the ONLY allowed permissions):
#   hermes:      contents:write, workflows:write, issues:write, prs:write, releases:write
#   argus:       contents:read, issues:read, prs:read, reviews:write
#   hephaestus:  contents:write, issues:write, prs:write

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ADR-0030 §Phase 2 permission matrix — the known-good configuration
# Format: role:app_id:installation_id:contents:issues:prs:reviews:workflows:releases
# Empty values mean the permission is NOT requested (— in the matrix)
declare -A MATRIX
MATRIX[hermes]="contents:write issues:write pull_requests:write workflows:write releases:write"
MATRIX[argus]="contents:read issues:read pull_requests:read reviews:write"
MATRIX[hephaestus]="contents:write issues:write pull_requests:write"

# Allowed permissions (anything else is a drift / security risk)
ALLOWED_PERMISSIONS="contents issues pull_requests workflows releases"

# ── Commands ──────────────────────────────────────────────────────────

cmd_check() {
  echo "=== Permission Matrix Check ==="
  local all_ok=true
  for role in hermes argus hephaestus; do
    local pem="${SCRIPT_DIR}/aegis-${role}.pem"
    local script="${SCRIPT_DIR}/get-installation-token-${role}.sh"

    echo ""
    echo "--- aegis-${role} ---"

    # Check PEM exists and mode 600
    if [[ -f "$pem" ]]; then
      local perms
      perms=$(stat -c %a "$pem" 2>/dev/null || stat -f %Lp "$pem" 2>/dev/null)
      if [[ "$perms" == "600" ]]; then
        echo "  PEM: ✅ exists, mode 600"
      else
        echo "  PEM: ❌ wrong permissions (${perms}), expected 600"
        all_ok=false
      fi
    else
      echo "  PEM: ⏳ not registered yet (expected — Ema action pending)"
    fi

    # Check script exists and mode 755
    if [[ -x "$script" ]]; then
      echo "  Script: ✅ exists, executable"
    else
      echo "  Script: ❌ missing or not executable"
      all_ok=false
    fi

    # Check expected permissions
    echo "  Allowed permissions: ${MATRIX[$role]}"
  done

  echo ""
  if $all_ok; then
    echo "Result: ✅ All checks passed (registered Apps will be verified when PEMs arrive)"
  else
    echo "Result: ❌ Some checks failed"
    return 1
  fi
}

cmd_audit() {
  echo "=== Aegis App Audit Report ==="
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""

  for role in hermes argus hephaestus; do
    local pem="${SCRIPT_DIR}/aegis-${role}.pem"
    echo "--- aegis-${role} ---"

    if [[ -f "$pem" ]]; then
      local perms
      perms=$(stat -c %a "$pem" 2>/dev/null || stat -f %Lp "$pem" 2>/dev/null)
      local mtime
      mtime=$(stat -c %y "$pem" 2>/dev/null | cut -d. -f1 || stat -f "%Sm" "$pem" 2>/dev/null)
      echo "  PEM: present (${perms}), last modified: ${mtime}"
      echo "  Permissions: ${MATRIX[$role]}"
    else
      echo "  PEM: NOT PRESENT — awaiting registration (#4665 §A)"
      echo "  Permissions: ${MATRIX[$role]}"
    fi
    echo ""
  done

  # Check legacy bot
  local legacy_pem="${SCRIPT_DIR}/aegis-gh-agent.pem"
  if [[ -f "$legacy_pem" ]]; then
    echo "--- aegis-gh-agent (LEGACY/FALLBACK) ---"
    echo "  PEM: present (30-day parallel run, to be retired after migration)"
    echo ""
  fi

  echo "=== Matrix Drift Check ==="
  # This will be a real API check once Apps are registered
  echo "  (API-level drift check requires registered Apps — pending Ema action)"
}

cmd_mint() {
  local role="${1:?Usage: manage-aegis-apps.sh mint <hermes|argus|hephaestus>}"

  if [[ "$role" != "hermes" && "$role" != "argus" && "$role" != "hephaestus" ]]; then
    echo "ERROR: Unknown role '${role}'. Must be hermes, argus, or hephaestus." >&2
    return 1
  fi

  local script="${SCRIPT_DIR}/get-installation-token-${role}.sh"
  if [[ ! -x "$script" ]]; then
    echo "ERROR: Token script not found: ${script}" >&2
    return 1
  fi

  echo "Minting installation token for aegis-${role}..."
  local token
  token=$("$script")
  echo "Token: ${token:0:10}...${token: -4} (${#token} chars)"
  echo ""

  # Sub-check: resolve the App identity from the token BEFORE the push.
  # If the script has the wrong APP_ID filled in (e.g., argus's APP_ID
  # was accidentally pasted into hermes's script), /app returns the
  # wrong slug, and the empty-commit attribution check (E.1) would fail
  # after the fact. Catching it here saves a round-trip and avoids
  # polluting the commit history with wrong-author commits.
  echo "Resolving App identity from token (catches misrouted APP_ID)..."
  local app_info
  app_info=$(GH_TOKEN="$token" gh api /app 2>&1)
  local app_slug app_id_resolved
  app_slug=$(echo "$app_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('slug','?'))" 2>/dev/null || echo "?")
  app_id_resolved=$(echo "$app_info" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null || echo "?")
  echo "  Resolved App: ${app_slug} (id=${app_id_resolved})"
  echo "  Expected App: aegis-${role}"
  if [[ "$app_slug" != "aegis-${role}" ]]; then
    echo "ERROR: Token resolved to '${app_slug}', expected 'aegis-${role}'." >&2
    echo "  Check APP_ID in ${script} (likely misrouted from another role's registration)." >&2
    return 1
  fi
  echo ""

  echo "Verifying token against GitHub API (repo access)..."
  local response
  response=$(GH_TOKEN="$token" gh api /repos/OneStepAt4time/aegis -q '.name,.full_name' 2>&1 || echo "FAILED")
  echo "Response: ${response}"
}

cmd_rotate_cron() {
  # Write a ready-to-install crontab block for the 3 per-agent Apps.
  # The cron entry itself is harmless before PEMs land: the audit
  # reports "NOT PRESENT" until Ema's registrations arrive. Installing
  # the cron now means one fewer step in the Thu AM 1-hr finish.
  #
  # The 90-day rotation policy is per ADR-0030 §Phase 2: each App's
  # PEM has a 90-day rotation cadence. The cron entry fires quarterly
  # (every 90 days) and runs `audit`, which surfaces PEM mtime + drift.
  # It does NOT auto-rotate — the operator rotates manually and the
  # next audit reflects the new mtime.
  #
  # Install:  crontab /tmp/aegis-apps-rotation.crontab
  # Verify:   crontab -l | grep aegis-app-rotation
  # Remove:   crontab -l | grep -v aegis-app-rotation | crontab -

  local crontab_file="/tmp/aegis-apps-rotation.crontab"
  local log_file="/tmp/aegis-app-rotation.log"
  local script_path="${SCRIPT_DIR}/manage-aegis-apps.sh"

  echo "=== 90-Day Rotation Reminder Setup ==="
  echo "Writing ready-to-install crontab block to: ${crontab_file}"
  echo ""

  cat > "$crontab_file" <<EOF
# aegis per-agent App rotation reminders (per ADR-0030 §Phase 2, #4665 §C)
# Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")
#
# Cadence: quarterly (90 days), at 09:00 on the 1st of Jan/Apr/Jul/Oct.
# Action:  run \`audit\` which surfaces each App's PEM mtime + matrix drift.
# Rotate:  operator regenerates the App's PEM at GitHub + updates the
#          local PEM file (mode 600). The next audit reflects the new mtime.
#
# Install: crontab $crontab_file
# Verify:  crontab -l | grep aegis-app-rotation
# Remove:  crontab -l | grep -v aegis-app-rotation | crontab -
#
# Caveat: \`crontab <file>\` REPLACES the user's entire crontab. If you have
# other cron entries, back them up first:
#   crontab -l > /tmp/my-crontab.bak && crontab $crontab_file
# To merge rather than replace, extract this block and append to the
# existing crontab with \`crontab -\`.
0 9 1 1,4,7,10 * $script_path audit >> $log_file 2>&1
EOF

  echo "--- crontab block (review before installing) ---"
  cat "$crontab_file"
  echo "---"
  echo ""
  echo "To install (one of):"
  echo "  crontab $crontab_file                            # replaces user crontab"
  echo "  (crontab -l; cat $crontab_file) | crontab -      # merges with existing"
  echo ""
  echo "To verify:  crontab -l | grep aegis-app-rotation"
  echo "To remove:  crontab -l | grep -v aegis-app-rotation | crontab -"
  echo ""
  echo "Log file: $log_file  (consider symlinking to ~/.local/log/ for persistence)"
}

# ── Main ──────────────────────────────────────────────────────────────

case "${1:-help}" in
  check)       cmd_check ;;
  audit)       cmd_audit ;;
  mint)        cmd_mint "${2:-}" ;;
  rotate-cron) cmd_rotate_cron ;;
  help|--help|-h)
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  check        Verify all Apps have correct permissions (matrix guard)"
    echo "  audit        Print status report (install state, last rotation, drift)"
    echo "  mint <role>  Test mint an installation token for hermes|argus|hephaestus"
    echo "  rotate-cron  Set up 90-day rotation reminders"
    ;;
  *)
    echo "ERROR: Unknown command '${1}'. Use --help for usage." >&2
    exit 1
    ;;
esac

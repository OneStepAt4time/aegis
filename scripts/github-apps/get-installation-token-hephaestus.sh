#!/usr/bin/env bash
# Generate a GitHub App installation access token for aegis-hephaestus
# Usage: ./get-installation-token-hephaestus.sh
# Requires: openssl, curl, python3
# PEM file: sibling aegis-hephaestus.pem (mode 600)
#
# #4665 §B: per-agent token mint. Returns 1h-TTL installation token.
# No PEM content in argv or stdout (token only).

set -euo pipefail

APP_ID=""        # Filled when Ema registers the App
INSTALLATION_ID=""  # Filled when App is installed on the repo
PEM_FILE="$(dirname "$0")/aegis-hephaestus.pem"

if [[ ! -f "$PEM_FILE" ]]; then
  echo "ERROR: PEM file not found: $PEM_FILE" >&2
  echo "Register aegis-hephaestus App first (see #4665 §A)" >&2
  exit 1
fi

if [[ "$(stat -L -c %a "$PEM_FILE" 2>/dev/null || stat -f %Lp "$PEM_FILE" 2>/dev/null)" != "600" ]]; then
  echo "ERROR: PEM file has wrong permissions (expected 600): $PEM_FILE" >&2
  exit 1
fi

if [[ -z "$APP_ID" || -z "$INSTALLATION_ID" ]]; then
  echo "ERROR: APP_ID and INSTALLATION_ID must be set. Fill in after Ema registers the App (#4665 §A)." >&2
  exit 1
fi

# Generate JWT (10min max lifetime per GitHub requirement)
NOW=$(date +%s)
IAT=$((NOW - 60))
EXP=$((NOW + 600))

# Base64url encode (no padding)
b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

HEADER=$(echo -n '{"alg":"RS256","typ":"JWT"}' | b64url)
PAYLOAD=$(echo -n "{\"iat\":${IAT},\"exp\":${EXP},\"iss\":${APP_ID}}" | b64url)

SIGNATURE=$(echo -n "${HEADER}.${PAYLOAD}" | \
  openssl dgst -sha256 -sign "$PEM_FILE" | b64url)

JWT="${HEADER}.${PAYLOAD}.${SIGNATURE}"

# Get installation token (1h TTL)
TOKEN=$(curl -sf -X POST \
  -H "Authorization: Bearer ${JWT}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo "$TOKEN"

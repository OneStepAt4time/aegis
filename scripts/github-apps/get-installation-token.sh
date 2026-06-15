#!/usr/bin/env bash
# Generate a GitHub App installation access token
# Usage: ./get-installation-token.sh
# Requires: openssl, curl, python3 (for base64url)

set -euo pipefail

APP_ID="3235882"
INSTALLATION_ID="120423675"
PEM_FILE="$(dirname "$0")/aegis-gh-agent.pem"

# Generate JWT
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

# Get installation token
TOKEN=$(curl -s -X POST \
  -H "Authorization: Bearer ${JWT}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo "$TOKEN"

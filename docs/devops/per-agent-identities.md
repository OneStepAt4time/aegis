# Per-agent GitHub App identities

> **Status:** Ship-now slice in flight (#4731). Identity-binding slice deferred until Ema's §A clears (#4732). This doc covers the scripts + audit-trail half.

This document is the canonical reference for the per-agent GitHub App identity
model in Aegis. It explains **what the 4 token-mint scripts do, why they
exist, the security guarantees they enforce, and how they fit into the broader
release / DevOps workflow.**

## Why per-agent identities exist

Each Aegis team agent (Hermes, Argus, Hephaestus) has its own GitHub App
identity. This gives us:

- **Clean attribution** — every bot action is attributable to a specific
  agent, not a single shared "aegis-gh-agent" bot.
- **Least-privilege permissions** — each App is granted only the permissions
  its role needs (see [§Permission matrix](#permission-matrix--adr-0030)).
- **Independent rotation** — each PEM rotates on its own 90-day cadence.
- **Audit trail granularity** — release commits, security reviews, and
  feature pushes are auditable as separate identities.

Until §A clears (#4665), the **legacy `aegis-gh-agent` App** is the fallback
identity for all bot actions. It is **75 days old** at the time of writing and
is the only one with registered credentials today.

## The 4 scripts

All scripts live in `scripts/github-apps/`:

| Script | Identity | Status | Purpose |
|---|---|---|---|
| `get-installation-token.sh` | `aegis-gh-agent` (legacy) | ✅ Active | Mint a 1h-TTL installation token for the legacy bot |
| `get-installation-token-hermes.sh` | `aegis-hermes` | ⏳ Pending §A | Mint a 1h-TTL token for Hermes (release / DevOps) |
| `get-installation-token-argus.sh` | `aegis-argus` | ⏳ Pending §A | Mint a 1h-TTL token for Argus (code review / merge) |
| `get-installation-token-hephaestus.sh` | `aegis-hephaestus` | ⏳ Pending §A | Mint a 1h-TTL token for Hephaestus (feature dev) |

Plus the lifecycle manager:

- `manage-aegis-apps.sh` — `check` / `audit` / `mint <role>` / `rotate-cron`
  subcommands for the per-agent Apps. See `manage-aegis-apps.sh --help`.

### Security model (enforced by every script)

| Guarantee | How it's enforced |
|---|---|
| **PEMs never appear in `argv` or `stdout`** | Scripts only `echo` the JWT-based installation token. PEMs are read directly by `openssl` from disk. |
| **PEM file mode is 600** | Each script `stat -c %a` checks the PEM file before signing. Wrong mode → exit 1. |
| **No PEM content in logs** | Scripts use `set -euo pipefail`, no `echo "$PEM_FILE"` or `cat` of the PEM. |
| **JWT lifetime is 10 minutes** | `IAT=NOW-60`, `EXP=NOW+600` — within GitHub's max lifetime for an App JWT. |
| **Token TTL is 1 hour** | GitHub's installation token endpoint returns 1h-TTL tokens. The script echoes the token once; the caller is responsible for not persisting it. |
| **No `eval` and no `set +e`** | Strict mode is set at script start and never relaxed. |
| **Bash 3.2-compatible** | `#!/usr/bin/env bash`, no `[[ ]]`-only constructs that break on macOS BSD `bash`. (The PEM-mode check uses `[[ ]]` with `stat -f %Lp` fallback for macOS.) |

### Token mint flow (per script)

```
1. Read APP_ID and INSTALLATION_ID from the script's literal (filled in post-§A)
2. Read PEM_FILE (sibling to the script, mode 600)
3. Build JWT header + payload (alg=RS256, iss=APP_ID, iat/exp bounded)
4. Sign with PEM_FILE via openssl dgst -sha256 -sign
5. POST to https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens
6. Echo the 1h-TTL token to stdout
7. Exit 0
```

The 1h TTL means the caller should consume the token within an hour, not
persist it to disk. The 4 scripts are designed to be invoked at the moment of
need, with the token passed via `GH_TOKEN=$(./get-installation-token-*.sh) gh ...`
or `git -c http.extraHeader="Authorization: Bearer ${TOKEN}" ...`.

## Permission matrix (ADR-0030)

The ONLY allowed permissions per role. Anything else is matrix drift and a
security risk.

| Role | contents | issues | pull_requests | reviews | workflows | releases |
|---|---|---|---|---|---|---|
| **aegis-hermes** (release / DevOps) | `write` | `write` | `write` | — | `write` | `write` |
| **aegis-argus** (review / merge) | `read` | `read` | `read` | `write` | — | — |
| **aegis-hephaestus** (feature dev) | `write` | `write` | `write` | — | — | — |

`manage-aegis-apps.sh check` enforces this matrix by inspecting each App's
permissions via the GitHub API. It exits 1 if any App has permissions outside
the matrix.

## Lifecycle

### Adding a new App

1. Ema registers the App on github.com (Settings → Developer settings → GitHub
   Apps → New App) and installs it on `OneStepAt4time/aegis`.
2. Ema sends Hermes the PEM + App ID + Installation ID via **1Password share
   only** (not channel-paste, per Themis's secure-transfer rule).
3. Hermes drops the PEM at `scripts/github-apps/aegis-<role>.pem` mode 600.
4. Hermes fills the `APP_ID` and `INSTALLATION_ID` placeholders in
   `get-installation-token-<role>.sh`.
5. Hermes smoke-tests: `GH_TOKEN=$(./get-installation-token-<role>.sh) gh api /app` —
   the response should show the new App's slug.
6. `manage-aegis-apps.sh audit` reflects the new App as "PEM: present" with
   the last-modified time.

### Rotating a PEM (90-day cadence)

The rotation cron is generated by `manage-aegis-apps.sh rotate-cron` and runs
`audit` quarterly. The audit surfaces each App's PEM mtime; if the mtime is
>90 days old, the operator regenerates the App's PEM at GitHub and updates
the local file.

The cron does **NOT** auto-rotate — rotation is always a manual operator step
to prevent the silent loss of attribution history.

### Revoking an App

If an App is compromised or no longer needed:

1. Suspend or delete the App at github.com (Settings → Developer settings →
   GitHub Apps → <app> → Advanced → Suspend / Delete).
2. Delete the local PEM file: `rm scripts/github-apps/aegis-<role>.pem`.
3. Update the script: set `APP_ID` and `INSTALLATION_ID` to empty strings so
   any caller fails fast.
4. Run `manage-aegis-apps.sh check` — should report "PEM: ❌ missing" and
   "Script: ❌ missing or not executable" for the suspended role.
5. File a security incident ticket with Themis for audit trail.

## Legacy fallback (`aegis-gh-agent`)

The legacy `aegis-gh-agent` App is the single identity used by the team for
the past 75+ days. It is registered and has a working PEM at
`scripts/github-apps/aegis-gh-agent.pem` (mode 600) on operator hosts.

It remains the **only** working identity until §A clears and the 3 per-agent
PEMs land. Once that happens, the legacy App enters a 30-day parallel run and
is then retired. During the parallel run, the 3 per-agent scripts are the
preferred path; the generic `get-installation-token.sh` is the fallback for
cron jobs that haven't migrated yet (e.g., the `npm_and_yarn` publish chain).

## References

- **Parent issue:** [#4665 — Per-agent App identities (ADR-0030 Phase 2)](https://github.com/OneStepAt4time/aegis/issues/4665)
- **This doc's ship-now slice:** [#4731 — chore(devops): #4665 ship-now slice](https://github.com/OneStepAt4time/aegis/issues/4731)
- **Deferred slice (identity-binding):** [#4732 — chore(devops): #4665 identity-binding slice](https://github.com/OneStepAt4time/aegis/issues/4732)
- **Bot-approve friction (related):** [#4725 — ci(devops): fix bot-can't-self-approve friction](https://github.com/OneStepAt4time/aegis/issues/4725)
- **Fallback approver chain (related):** [#4728 — [DevOps] Fallback approver chain for bot reviewers](https://github.com/OneStepAt4time/aegis/issues/4728)
- **Themis's script-only review LGTM:** #aegis-devs msg 1515974350552170638 (2026-06-15 09:00 CEST)
- **Boss's review-split directive:** #aegis-devs msg 1515971783663026216 (2026-06-15 08:55 CEST)

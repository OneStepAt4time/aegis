# Air-Gapped Deployment Guide

Deploy Aegis in environments with no internet access — isolated networks, classified systems, or regulated infrastructure where outbound connections are prohibited.

Aegis is fully self-contained at runtime. It makes no outbound calls to external services during normal operation. The dashboard, API, MCP server, and session management all work without internet connectivity.

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| Node.js | 20+ | LTS recommended |
| npm | 10+ | For package installation |
| tmux | 3.2+ | Session management |
| Claude Code CLI | Latest | Must be installed and authenticated separately |
| Linux | Any | macOS also supported; Windows via WSL2 |

> **Note:** Claude Code CLI must be pre-installed and pre-authenticated before transferring to the air-gapped environment. Aegis orchestrates Claude Code sessions but does not handle Claude Code's own installation or LLM endpoint configuration. See [BYO LLM](./byo-llm.md) for configuring non-Anthropic endpoints that may already be available on your internal network.

## Offline Installation Methods

### 1. Release Tarball

The simplest method — download once, transfer via sneakernet or one-way data diode.

**On an internet-connected machine:**

```bash
# Download the release tarball and checksums
VERSION="0.6.0-preview"
curl -LO "https://github.com/OneStepAt4time/aegis/releases/download/v${VERSION}/aegis-${VERSION}.tgz"
curl -LO "https://github.com/OneStepAt4time/aegis/releases/download/v${VERSION}/SHA256SUMS"

# Verify integrity
sha256sum -c SHA256SUMS --ignore-missing

# Optional: verify Sigstore attestation (see verify-release.md)
gh release download "v${VERSION}" --pattern '*.sigstore' --dir /tmp
```

**Transfer** the verified files to the air-gapped network (USB, one-way diode, internal file share).

**On the air-gapped machine:**

```bash
# Extract and install
mkdir -p /opt/aegis
tar xzf aegis-0.6.0-preview.tgz -C /opt/aegis --strip-components=1
cd /opt/aegis

# Install dependencies from bundled node_modules (if included)
# or from a vendored archive (see Pre-packaging Dependencies below)
npm install --offline

# Build
npm run build

# Verify
node dist/server.js --version
```

### 2. Local npm Registry

For teams that manage packages through an internal registry (Verdaccio, Artifactory, Nexus).

**On an internet-connected machine:**

```bash
# Download the package and all dependencies
mkdir aegis-offline && cd aegis-offline
npm pack @onestepat4time/aegis

# Generate a full dependency tree
npm install @onestepat4time/aegis --global-style --dry-run 2>&1 | tee install-manifest.txt
```

**Publish to your internal registry:**

```bash
# Verdaccio example
npm publish aegis-0.6.0-preview.tgz --registry https://npm.internal.example.com

# Or Artifactory
curl -u user:token -X PUT \
  "https://artifactory.internal/example/npm-local/aegis/-/aegis-0.6.0-preview.tgz" \
  -T aegis-0.6.0-preview.tgz
```

**On the air-gapped machine:**

```bash
# Configure npm to use your internal registry
npm config set registry https://npm.internal.example.com

# Install
npm install -g @onestepat4time/aegis
```

### 3. Filesystem Mirror

For environments without a registry server — copy the full dependency tree as files.

**On an internet-connected machine:**

```bash
# Clone and install everything
git clone https://github.com/OneStepAt4time/aegis.git /tmp/aegis-mirror
cd /tmp/aegis-mirror
git checkout v0.6.0-preview
npm install

# Archive the entire directory including node_modules
tar czf aegis-full-0.6.0-preview.tar.gz -C /tmp aegis-mirror/
```

**On the air-gapped machine:**

```bash
tar xzf aegis-full-0.6.0-preview.tar.gz -C /opt/
cd /opt/aegis-mirror

# Build and run (node_modules already present)
npm run build
node dist/server.js
```

## Pre-packaging Dependencies

### npm Packages

When using the tarball method, bundle `node_modules` ahead of time:

```bash
# On connected machine: create a vendored dependency archive
cd /tmp/aegis-mirror
npm install --production=false   # include devDependencies for build step
tar czf node_modules.tar.gz node_modules/

# Transfer both archives to air-gapped machine:
#   aegis-0.6.0-preview.tgz
#   node_modules.tar.gz

# On air-gapped machine
cd /opt/aegis
tar xzf node_modules.tar.gz      # restores node_modules/
npm run build                    # build from vendored deps
npm prune --omit=dev             # remove devDependencies after build
```

### Docker Images

For containerized air-gapped deployments, save and load images manually:

**On an internet-connected machine:**

```bash
# Pull and save
docker pull ghcr.io/onestepat4time/aegis:0.6.0-preview
docker save ghcr.io/onestepat4time/aegis:0.6.0-preview \
  -o aegis-image-0.6.0-preview.tar

# Optional: compress
gzip aegis-image-0.6.0-preview.tar
```

**On the air-gapped machine:**

```bash
# Load into local container runtime
docker load -o aegis-image-0.6.0-preview.tar

# Run with internal-only networking
docker run -d \
  --name aegis \
  --network internal \
  -p 9100:9100 \
  -e AEGIS_AUTH_TOKEN=your-secure-token \
  -v aegis-data:/root/.aegis \
  -v claude-data:/root/.claude \
  ghcr.io/onestepat4time/aegis:0.6.0-preview
```

For Docker Compose, use the same saved image and reference it in your compose file:

```yaml
services:
  aegis:
    image: ghcr.io/onestepat4time/aegis:0.6.0-preview
    # Rest of config as in deployment.md
```

### Helm Chart

For Kubernetes deployments on isolated clusters:

**On an internet-connected machine:**

```bash
# Pull the chart
helm pull aegis/aegis --version 0.6.0-preview --destination /tmp/

# Or from the repo directly
helm template aegis aegis/aegis --version 0.6.0-preview > /tmp/aegis-manifest.yaml

# Save both the chart and the container image
helm pull aegis/aegis --version 0.6.0-preview --destination /tmp/
docker pull ghcr.io/onestepat4time/aegis:0.6.0-preview
docker save ghcr.io/onestepat4time/aegis:0.6.0-preview -o /tmp/aegis-image.tar
```

**On the air-gapped cluster:**

```bash
# Load the container image into your cluster's container runtime
# (method depends on your registry setup: Harbor, internal registry, etc.)
ctr -n k8s.io images import aegis-image.tar

# Install from local chart archive
helm upgrade --install aegis ./aegis-0.6.0-preview.tgz \
  --namespace aegis \
  --create-namespace \
  --set image.repository=ghcr.io/onestepat4time/aegis \
  --set image.tag=0.6.0-preview \
  --set aegis.authToken=your-secure-token
```

## Network Configuration

Aegis requires no outbound internet access. The following configuration ensures internal-only operation.

### Environment Variables

Set these environment variables to disable any optional outbound features:

| Variable | Value | Purpose |
|----------|-------|---------|
| `AEGIS_HOST` | `0.0.0.0` or internal IP | Bind to internal interface only |
| `AEGIS_PORT` | `9100` | Default port (configurable) |
| `AEGIS_AUTH_TOKEN` | Your token | Required for all API calls |

### Dashboard Update Checks

The dashboard's CSP header includes `https://registry.npmjs.org` in `connect-src` for version update checks. In an air-gapped environment, remove this directive:

```nginx
# Reverse proxy override — remove registry.npmjs.org from connect-src
proxy_hide_header Content-Security-Policy;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
```

This prevents the dashboard from attempting to reach the npm registry for version checks.

### Firewall Rules

Allow only internal traffic:

| Direction | Port | Protocol | Purpose |
|-----------|------|----------|---------|
| Inbound | 9100 | TCP | Aegis HTTP API + dashboard |
| Inbound | 9100 | WS | WebSocket (session streaming) |
| Outbound | — | — | **Block all outbound by default** |

No outbound connections are required for Aegis itself. If your Claude Code CLI is configured to use an internal LLM endpoint, ensure connectivity to that endpoint is allowed.

### Internal LLM Endpoint

When deploying air-gapped, Claude Code must target an LLM endpoint reachable from the internal network. Configure this via Claude Code's own settings:

```bash
# Set Claude Code to use an internal endpoint
# (refer to Claude Code documentation for current configuration method)
claude config set apiEndpoint https://llm.internal.example.com/v1
```

See [BYO LLM](./byo-llm.md) for details on supported endpoint types (LM Studio, Ollama, Azure OpenAI, OpenRouter, etc.).

## Licensing and Activation

Aegis is released under the **MIT License**. There are no license keys, activation servers, or phone-home callbacks.

- **No internet required for licensing.** Install and run without contacting any external service.
- **No feature gating.** All features are available in the single edition.
- **No telemetry.** Aegis does not collect or transmit usage data.

### Dependency Attribution

When bundling Aegis for air-gapped distribution, include dependency license information:

```bash
# Generate a license inventory on a connected machine
cd /tmp/aegis-mirror
npx license-checker --json > dependency-licenses.json
npx license-checker --csv > dependency-licenses.csv
```

Include the generated `dependency-licenses.csv` alongside your air-gapped distribution package. Aegis and all its dependencies use permissive licenses (MIT, Apache-2.0, BSD-2/3-Clause).

### Sigstore Verification (Optional)

Air-gapped consumers who want to verify Sigstore attestations must fetch Sigstore's public good-instance roots out-of-band before transfer. See [verify-release.md](./verify-release.md) for the full verification procedure.

## Updating Air-Gapped Installations

Updates follow the same transfer pattern as the initial installation. No live update mechanism requires internet access.

### Update Process

1. **On a connected machine:** Download the new tarball, verify its checksums (see [verify-release.md](./verify-release.md))
2. **Transfer** the verified files to the air-gapped network
3. **Install** over the existing deployment

```bash
# Tarball update
cd /opt/aegis
tar xzf aegis-0.7.0-preview.tgz --strip-components=1
npm install --offline    # if node_modules are bundled
npm run build
sudo systemctl restart aegis

# Docker update
docker load -o aegis-image-0.7.0-preview.tar
docker stop aegis
docker rm aegis
docker run -d \
  --name aegis \
  -p 9100:9100 \
  -e AEGIS_AUTH_TOKEN=your-secure-token \
  -v aegis-data:/root/.aegis \
  -v claude-data:/root/.claude \
  ghcr.io/onestepat4time/aegis:0.7.0-preview

# Helm update
helm upgrade --install aegis ./aegis-0.7.0-preview.tgz \
  --namespace aegis \
  --set image.tag=0.7.0-preview
```

### Rollback

If an update fails, roll back to the previous version:

```bash
# Systemd — restore previous build
cd /opt/aegis
tar xzf aegis-0.6.0-preview.tgz --strip-components=1
npm run build
sudo systemctl restart aegis

# Docker — re-run with previous image
docker stop aegis && docker rm aegis
docker run -d --name aegis ... ghcr.io/onestepat4time/aegis:0.6.0-preview

# Helm
helm rollback aegis --namespace aegis
```

See [incident-rollback-runbook.md](./incident-rollback-runbook.md) for the full rollback procedure.

## Security Considerations

### Integrity Verification

Always verify release integrity before transferring to the air-gapped network. A compromised package transferred via sneakernet bypasses network-level security controls.

```bash
# Verify SHA-256 on the connected machine BEFORE transfer
sha256sum -c SHA256SUMS --ignore-missing
```

### Authentication

In air-gapped environments, Aegis API authentication (`AEGIS_AUTH_TOKEN`) is your primary security boundary. Consider:

- Generate strong, unique tokens (≥32 characters)
- Rotate tokens on a schedule appropriate for your security posture
- Place Aegis behind an internal reverse proxy that adds TLS termination and your organization's authentication layer (SSO, LDAP, mTLS)

### Data at Rest

Aegis stores session state and audit logs in `AEGIS_STATE_DIR` (default `~/.aegis`). Ensure this directory:

- Is encrypted at rest (LUKS, dm-crypt, or equivalent)
- Has restrictive filesystem permissions (`0700`)
- Is backed up according to your retention policy

### Claude Code Credentials

Claude Code stores its authentication material in `CLAUDE_DATA_DIR` (default `~/.claude`). When operating air-gapped with a BYO LLM endpoint, ensure the endpoint's credentials are protected at the same security level.

### Audit Logging

Aegis logs all API requests. In air-gapped deployments, direct logs to your internal SIEM or log aggregation system:

```bash
# Forward Aegis logs via systemd journal
journalctl -u aegis -f | your-log-shipper

# Or configure log output to a file consumed by your SIEM
AEGIS_LOG_FILE=/var/log/aegis/aegis.log
```

### Dashboard Access

Restrict dashboard access to authorized internal networks. Do not expose port 9100 beyond the management network:

```bash
# Bind to internal interface only
AEGIS_HOST=10.0.0.10

# Or use a reverse proxy with IP allowlisting
```

## Related Documentation

- [Deployment Guide](./deployment.md) — general deployment procedures
- [Enterprise Onboarding](./enterprise-onboarding.md) — on-premises deployment overview
- [Verifying Releases](./verify-release.md) — SHA-256 and Sigstore verification
- [BYO LLM](./byo-llm.md) — configuring non-Anthropic LLM endpoints
- [Troubleshooting](./troubleshooting.md) — common deployment issues
- [Architecture](./architecture.md) — system architecture overview

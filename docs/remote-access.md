# Remote Access

This guide shows how to reach a home or office Aegis instance from anywhere
without exposing port `9100` directly to the public internet.

For remote-access deployments, explicitly keep Aegis on
`AEGIS_HOST=127.0.0.1` and let a tunnel or reverse proxy reach loopback.
Aegis does not ship its own ingress layer, and the dashboard uses the same API
token model as the REST API, so remote access is always a two-layer problem:

1. **Transport** — get traffic from the remote client to the host over TLS
   without opening inbound firewall ports.
2. **Authentication** — protect the API token and, for anything beyond a
   private tailnet, add an upstream identity gate in front of the dashboard.

This guide covers three transport options and the security posture each one
expects.

---

## Choosing an option

| Option | Best for | Public URL | TLS | Identity layer | Cost |
|---|---|---|---|---|---|
| **Tailscale** | Solo dev on trusted devices | No | Auto | Tailnet users + ACLs | Free personal |
| **Cloudflare Tunnel** | Stable HTTPS URL for a small team | Yes | Auto | Cloudflare Access | Free tier |
| **ngrok** | Short demos or temporary access | Yes | Auto | Paid plans only | Free + paid |

**Recommendation:** use **Tailscale** unless you need a public hostname or
need to share access with people who are not on your tailnet. Reach for
**Cloudflare Tunnel** when you do. Use **ngrok** for demos only.

Across all three options, keep Aegis listening on loopback:

```bash
AEGIS_HOST=127.0.0.1
AEGIS_PORT=9100
```

That keeps the local LAN out of scope and makes the tunnel the only ingress
path you have to secure.

---

## Option 1 — Tailscale (recommended)

Tailscale is the best fit for a solo developer: it gives you a private
WireGuard mesh between your own devices, plus a tailnet-only HTTPS endpoint
without opening the service to the public internet.

### Install and expose Aegis to the tailnet

Install the Tailscale app on the Aegis host and on each client device, then
sign in to the same tailnet. On a Linux host:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --https=443 http://127.0.0.1:9100
tailscale serve status
```

`tailscale serve` publishes the local Aegis server to your tailnet-only
`https://<hostname>.<tailnet>.ts.net/` domain while Aegis itself stays bound
to `127.0.0.1`.

### Reach Aegis

```bash
curl https://<hostname>.<tailnet>.ts.net/v1/health

curl -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  https://<hostname>.<tailnet>.ts.net/v1/sessions
```

The dashboard is available at
`https://<hostname>.<tailnet>.ts.net/dashboard/`.

### Recommended settings

- Enable **MagicDNS** and **HTTPS certificates** in the Tailscale admin.
- Use **ACLs** / **grants** so only your own devices or a small admin group can
  reach the service.
- Keep using `AEGIS_HOST=127.0.0.1`; let `tailscale serve` proxy to loopback.
- Do **not** use **Tailscale Funnel** unless you intentionally want public
  internet exposure and have reviewed the security section below first.

---

## Option 2 — Cloudflare Tunnel

`cloudflared` opens an outbound connection from the host to Cloudflare's edge.
You get a stable `https://aegis.example.com` URL backed by Cloudflare TLS with
no inbound firewall changes.

### Install

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

cloudflared tunnel login
cloudflared tunnel create aegis
```

### Route

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/you/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: aegis.example.com
    service: http://127.0.0.1:9100
  - service: http_status:404
```

```bash
cloudflared tunnel route dns aegis aegis.example.com
sudo cloudflared service install
```

### Put Cloudflare Access in front

Without Access, anyone who knows the URL only needs a valid Aegis token. Add a
Zero Trust **Access application** so the tunnel is gated before traffic reaches
Aegis:

1. Zero Trust dashboard → **Access** → **Applications** → add
   `aegis.example.com`.
2. Policy: **Require** email domain, one-time PIN, or your SSO provider.
3. Keep session duration short (for example 1–8 hours).

Cloudflare Access then becomes the first factor and the Aegis API token remains
the second.

### Health check

```bash
curl https://aegis.example.com/v1/health

curl -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  https://aegis.example.com/v1/sessions
```

---

## Option 3 — ngrok

ngrok is best for short-lived demos. On the free plan the URL changes on every
restart, and public protection features are limited. Treat ngrok as
**temporary access**, not a persistent deployment plan.

### Install and run

```bash
npm install -g ngrok
ngrok config add-authtoken <your-token>
ngrok http 127.0.0.1:9100
```

ngrok prints a `https://<random>.ngrok-free.app` URL that forwards to
`http://127.0.0.1:9100`.

### Minimum hardening

If you need ngrok up for more than a quick demo:

- Use a **reserved domain** (paid plan) so the URL is stable and auditable.
- Add **OAuth** or another auth policy at the tunnel edge — do not rely only on
  the Aegis token over a public demo URL.
- Rotate the token when the demo ends.

Example ngrok traffic policy:

```yaml
# oauth-policy.yml
on_http_request:
  - actions:
      - type: oauth
        config:
          provider: google
  - expressions:
      - "!(actions.ngrok.oauth.identity.email.endsWith('@example.com'))"
    actions:
      - type: deny
```

```bash
ngrok http 127.0.0.1:9100 \
  --domain=aegis-demo.ngrok.app \
  --traffic-policy-file=oauth-policy.yml
```

---

## Security considerations

Remote access amplifies weaknesses that may be tolerable on `localhost`. Treat
each item below as a gate, not a suggestion.

### API key scope

- `AEGIS_AUTH_TOKEN` is the bootstrap credential for the API and dashboard. A
  browser, phone, or laptop that stores it should be treated as a privileged
  admin endpoint.
- Prefer the **least-privileged API key** that still fits the job:
  - `viewer` for read-only monitoring
  - `operator` for normal session control
  - `admin` only for key management and full control
- Session ownership still applies to non-master keys, so a scoped key is safer
  than copying the same full-power token to every remote client.
- Generate strong secrets (for example `openssl rand -hex 32`), keep them out
  of the repo, and rotate them whenever a device leaves your control.
- Do not send tokens through the tunnel itself. Share them out-of-band with a
  password manager or secret store.

### CORS

Aegis is **CORS-disabled by default**. The bundled dashboard calls the API on
the same origin, so tunnels do not need CORS by themselves.

- If you put a separate web app in front of Aegis, set `CORS_ORIGIN` to an
  explicit allow-list:

  ```bash
  CORS_ORIGIN="https://openclaw.example.com,https://admin.example.com"
  ```

- `CORS_ORIGIN=*` is rejected at startup. Keep it that way for remote access;
  wildcard browser access plus a cached token is an unnecessary foot-gun.

### Content-Security-Policy (CSP)

The dashboard is served with:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self' ws: wss: https://registry.npmjs.org
```

- Same-origin tunnels (Tailscale, Cloudflare Tunnel, ngrok) work without
  changing the policy.
- If you add analytics, CDNs, or error-reporting scripts, update the CSP in
  Aegis itself instead of rewriting headers at the tunnel edge.
- Do not disable CSP to "fix" remote access. Mixed-content or wrong-origin
  issues are almost always better solved by fixing the tunnel URL.

### Dashboard auth

The dashboard has a login page, but it is only a thin wrapper around the same
API token model as the REST API:

- `/dashboard/` must stay publicly reachable enough to load the static login
  page, then the browser verifies the token via `/v1/auth/verify`.
- After sign-in, the token is stored in the browser. Use trusted devices only,
  and clear stored tokens when a browser profile is no longer trusted.
- There are no separate dashboard users, passwords, or MFA controls inside
  Aegis today, so **upstream identity matters**:
  - Tailscale: rely on tailnet membership plus ACLs.
  - Cloudflare Tunnel: require Cloudflare Access.
  - ngrok: require OAuth or keep it demo-only.
- Review `GET /v1/audit` after a suspected leak, but rotate the token first.

### Host binding

- Keep `AEGIS_HOST=127.0.0.1` and let the tunnel proxy to loopback.
- Avoid binding to `0.0.0.0` just because you added a tunnel. Doing both means
  the tunnel **and** your local network can reach Aegis.
- Verify the listener on the host:

  ```bash
  ss -tlnp | grep 9100
  ```

  You want to see `127.0.0.1:9100`, not `0.0.0.0:9100`.

---

## Operational checklist

Before leaving a remote-access setup running:

- [ ] `AEGIS_AUTH_TOKEN` or any API key is at least 32 random bytes and stored
      outside the repo.
- [ ] `AEGIS_HOST=127.0.0.1` is set explicitly on the host.
- [ ] The tunnel has its own identity layer enabled (tailnet ACLs, Cloudflare
      Access, or ngrok OAuth).
- [ ] `CORS_ORIGIN` is unset or a strict allow-list — never `*`.
- [ ] `/v1/health` works through the tunnel and privileged endpoints still
      return `401` without a token.
- [ ] Browsers allowed to use `/dashboard/` are trusted, because the token is
      stored locally after sign-in.
- [ ] You have a token-rotation runbook for lost devices, expired demos, and
      collaborator removal.

---

## Related documentation

- [Deployment Guide](./deployment.md) — systemd, Docker, reverse proxy, safer
  host binding.
- [Enterprise Deployment](./enterprise.md) — auth, rate limiting, hardening.
- [ADR-0023](./adr/0023-positioning-claude-code-control-plane.md) — why Aegis
  is a self-hosted control plane and not a SaaS.

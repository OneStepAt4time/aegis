# Aegis Roadmap

> **Aegis is in Preview.** Planning is organised into four phases driven by
> audience scale (single dev → team → enterprise). The positioning is locked
> in [ADR-0023](docs/adr/0023-positioning-claude-code-control-plane.md) and
> the complete gap analysis lives in
> [docs/enterprise/00-gap-analysis.md](docs/enterprise/00-gap-analysis.md).

---

## North Star

Be the most reliable, pleasant, self-hosted **control plane for Claude Code**
— used by a single developer orchestrating agents from a phone, a 10-person
team sharing a deployment, or an enterprise adopting it under SSO.

The orchestration pattern is the same at every scale; Aegis scales up with the
audience without rewrites. Aegis never orchestrates agents — it bridges them
to Claude Code.

---

## Positioning (locked)

- **Aegis is the control plane of Claude Code.** REST, MCP, SSE, WS, CLI, and
  notification channels on one server.
- **MIT, single edition.** No open-core, no BUSL.
- **BYO LLM is first-class.** Claude Code can point at Anthropic, GLM,
  OpenRouter, LM Studio, Ollama, Azure OpenAI, etc. Aegis owns no LLM cost.
- **Primary CLI command is `ag`**; `aegis` remains as alias.
- Self-hosted first. SaaS is off the table until there is demand and funding.

---

## Phase 1 — Foundations ✅ COMPLETE

**Goal:** Aegis safe, contract-first, and supply-chain-verifiable.

- [x] Session ownership authz on action routes ([ADR-0019](docs/adr/0019-session-ownership-authz.md))
- [x] Env-var denylist at session create ([ADR-0020](docs/adr/0020-env-var-denylist.md))
- [x] Credential scan in `hygiene-check`
- [x] OpenAPI 3.1 spec generated from Zod ([ADR-0018](docs/adr/0018-openapi-spec-from-zod.md))
- [x] SSE idle timeout + HTTP drain on shutdown ([ADR-0021](docs/adr/0021-sse-and-http-drain-timeouts.md))
- [x] Dashboard E2E active on PRs to `develop`
- [x] Branch coverage raised from 60 % to 65 %
- [x] Sigstore attestations on npm + container images ([ADR-0022](docs/adr/0022-sigstore-attestations.md))

Exit criterion: an external reviewer can verify the release, read an OpenAPI
contract, and run Aegis without exposing the host to env-based RCE.

---

## Phase 2 — Developer Delight + Team-Ready ✅ COMPLETE

**Goal:** the tool friends recommend; good enough for a 10-person team.

- [x] `ag` alias + interactive `ag init` ([ADR-0023](docs/adr/0023-positioning-claude-code-control-plane.md))
- [x] `ag doctor` diagnostics command
- [x] Official BYO LLM support: docs, `examples/byo-llm/`, CI mock smoke
- [x] Agent / skill / slash-command template gallery (`ag init --from-template`)
- [x] Remote-access guide (Tailscale, Cloudflare Tunnel, ngrok)
- [x] Mobile-first dashboard pass
- [x] Dashboard home / onboarding flow
- [x] Helm chart v1 (P1-9)
- [x] Per-action RBAC: `send`, `approve`, `reject`, `kill`, `create` (P0-6)
- [x] Audit export API + base UI (P1-8)
- [x] CSP + token out of localStorage (P0-8)
- [x] Fault-injection harness in release gate (P1-6)
- [x] Prompt-injection hardening for MCP prompts (P2-3)
- [x] Windows/macOS smoke on `develop` (subset; full matrix on tag) (P1-5)

**Exit validation:** see [PHASE2_EXIT_CHECKLIST.md](./PHASE2_EXIT_CHECKLIST.md). External team
deployment guide: [EXTERNAL_DEPLOYMENT_GUIDE.md](./EXTERNAL_DEPLOYMENT_GUIDE.md).

---

## Phase 3 — Team & Early-Enterprise (3–6 months, demand-driven) 🟢 ACTIVE (activated 2026-04-27)

**Goal:** first external team of 10 + can run Aegis in production.

Implementation checklist shipped; Phase 3 remains active until the external
production-use exit evidence is documented.

- [x] Pluggable `SessionStore` with Postgres implementation (P0-5) ✅ #2201
- [x] Pipeline state persistence on `StateStore` ✅ #2253
- [x] OpenTelemetry wired end-to-end ([ADR-0017](docs/adr/0017-opentelemetry-tracing.md), P1-3) ✅ #2242
- [x] SDKs for TypeScript and Python generated from OpenAPI (P2-5) ✅ #2232, #2234
- [x] SSO / OIDC (Entra ID, Google, Okta, Keycloak, Authentik) (P1-2) ✅ #2325
- [x] OAuth2 device flow for CLI (`ag login`) (P1-2) ✅ #2311, #2316
- [x] Multi-tenancy primitives: `tenantId` on keys / sessions / audit (P1-1) ✅ #2244
- [x] Workdir namespacing per tenant (P1-1) ✅ #2252
- [x] Dashboard virtualization + full a11y pass (P1-7) ✅ #2181, #2230
- [x] i18n scaffolding (EN + IT to start) ✅ #2235, #2241

---

## Phase 4 — Enterprise GA (6–12 + months, demand-driven)

All remaining P2 items from the gap analysis:

- [ ] Horizontal scaling (Redis-backed state, sticky routing) (P2-1)
- [ ] Compliance scaffolding (SOC2 control mapping, DPA template, retention policy) (P2-2)
- [ ] Disaster-recovery runbook (export/import, audit-chain backup) (P2-6)
- [ ] Secrets-manager integrations (Vault / AWS KMS / Azure KV) (P2-7)
- [ ] Observability bundles (Grafana dashboards, alert rules, OTLP / Datadog docs) (P2-8)
- [ ] Air-gapped deployment guide (P2-9)
- [ ] Per-tenant quotas (sessions / tokens / USD spend cap) (P2-10)
- [ ] Billing / metering hooks (P2-11)
- [ ] Webhook signature-verification helper SDK (P2-12)
- [ ] API versioning policy + deprecation headers + `/v2/` migration doc (P2-4)

---

## Explicitly Deferred / Dropped

- `AEGIS_EDITION` open-core flag — dropped. Single MIT edition.
- SaaS / hosted offering — off the table until demand and funding exist.
- Redis as default state store — deferred to Phase 4; Postgres in Phase 3.
- Kubernetes-as-default deployment — downgraded; systemd / Docker Compose
  remain the default path. Helm chart ships in Phase 2 for users who want it.
- Rewrite in Rust or Go — not under consideration. If a rewrite ever happens,
  Rust is the only candidate, and only on proven demand.

---

## Graduation Signals (preview → GA)

**Preview → GA** (end of Phase 2):
- [x] All Phase 2 items shipped
- [x] Rename "alpha" dist-tag and version suffix to "preview"
- [x] Public demo video of the mobile approval flow
- [x] Incident / rollback runbook validated at least once
- [x] Confirm first external team deployment

---

## Principles

1. **Quality over velocity** — every merged PR improves reliability or clarity.
2. **Security before convenience** — defaults must prevent risky behaviour.
3. **Deterministic gates** — local + CI checks are non-optional.
4. **Docs as contract** — behaviour and policy must match documentation.
5. **Same pattern at every scale** — no fork, no edition split, no rewrite.
6. **Release discipline** — planned releases require a real user-facing payload, a short-lived `release/<version>` branch, Release Please version/changelog preparation, dry-run validation, and a tag on `main`.
7. **Sustainable pace** — this is a part-time maintainer project; the roadmap
   is calibrated to that reality.

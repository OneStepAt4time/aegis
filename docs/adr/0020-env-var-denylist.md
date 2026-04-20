# ADR-0020: Env-Var Denylist on Session Create

## Status
Proposed

## Context

`POST /v1/sessions` accepts an optional `env` record that is forwarded to the Claude Code process via tmux. Env var **names** are validated by the regex `^[A-Z_][A-Z0-9_]*$` in [src/validation.ts](../../src/validation.ts). Values are not escaped or filtered.

That leaves a sensitive attack surface:

- `PATH` / `PATHEXT` — redirect `claude`, `git`, `bash` to attacker binaries.
- `LD_PRELOAD` / `LD_LIBRARY_PATH` (Linux), `DYLD_INSERT_LIBRARIES` (macOS) — load attacker shared objects.
- `NODE_OPTIONS` — `--require` arbitrary modules into the Claude runtime (if it is Node-based) or into Aegis-spawned helpers.
- `ANTHROPIC_API_KEY` — silently replace the upstream key for a session; session output is attacker-controlled.
- `GIT_SSH_COMMAND`, `GIT_EXEC_PATH`, `GIT_CONFIG_*` — hijack any `git` call made by the session.
- `PYTHONSTARTUP`, `PYTHONPATH` — inject code into any Python subprocess.
- Windows equivalents: `ComSpec`, `SystemRoot`, `APPDATA`, `USERPROFILE`, `PSModulePath`.

A single compromised `operator` key is enough to gain RCE on the Aegis host via any of the above.

Referenced as **P0-2** in [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md).

## Decision

Introduce a denylist of environment variable names that are rejected at request time, with an optional allowlist override for admin keys.

### Default denylist (indicative, not exhaustive)

```
PATH, PATHEXT, LD_PRELOAD, LD_LIBRARY_PATH, LD_AUDIT,
DYLD_INSERT_LIBRARIES, DYLD_LIBRARY_PATH, DYLD_FRAMEWORK_PATH,
NODE_OPTIONS, NODE_PATH,
ANTHROPIC_API_KEY, ANTHROPIC_*,
GIT_SSH_COMMAND, GIT_EXEC_PATH, GIT_CONFIG_SYSTEM, GIT_CONFIG_GLOBAL,
PYTHONSTARTUP, PYTHONPATH, PYTHONUSERBASE,
ComSpec, SystemRoot, APPDATA, USERPROFILE, PSModulePath, PROCESSOR_ARCHITECTURE
```

### Implementation

- Add `ENV_DENYLIST` and a `refine()` on the `env` Zod schema in [src/validation.ts](../../src/validation.ts). Reject with error code `ENV_VAR_FORBIDDEN` and include the offending name.
- Value-side hardening: strip CR/LF, reject control chars, cap length at 8 KiB.
- Config override: `AEGIS_ENV_DENYLIST` (additive), `AEGIS_ENV_ADMIN_ALLOWLIST` (names admins may still set).
- Audit every rejected attempt so abuse is visible in the chain.

### Test coverage

Reuse the existing [src/__tests__/env-denylist-1392.test.ts](../../src/__tests__/env-denylist-1392.test.ts) style: case-insensitive on Windows, wildcard support (`ANTHROPIC_*`), override behaviour for admin keys, audit emission.

## Consequences

- **Pros:** removes the most direct RCE vector for a compromised non-admin key; aligns with SSRF and workdir allowlists as a coherent boundary model.
- **Cons:** denylists are never complete. This ADR treats it as a defence-in-depth layer, not the only control. Admin keys must remain trusted; the allowlist is explicitly a privileged escape hatch.
- **Operator experience:** a small number of existing scripts relying on `PATH` overrides will need to use a wrapper workdir or switch to admin keys.

## Related

- Gap analysis: P0-2 in [00-gap-analysis.md](../enterprise/00-gap-analysis.md)
- [ADR-0001](0001-windows-env-injection-strategy.md) — prior Windows-specific env work
- Companion ADRs: [ADR-0019](0019-session-ownership-authz.md), [ADR-0021](0021-sse-and-http-drain-timeouts.md)

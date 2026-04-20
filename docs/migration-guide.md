# Migration Guide: `aegis-bridge` → `@onestepat4time/aegis`

This guide covers migrating from the deprecated `aegis-bridge` package to the new `@onestepat4time/aegis` package.

> The primary CLI command is now `ag`. The legacy name `aegis` remains available as an alias for backward compatibility.

---

## What Changed

| Item | Old | New |
|---|---|---|
| Package name | `aegis-bridge` | `@onestepat4time/aegis` |
| npm install | `npm install -g aegis-bridge` | `npm install -g @onestepat4time/aegis` |
| npx run | `npx aegis-bridge` | `npx --package=@onestepat4time/aegis ag` |
| CLI binary | `aegis-bridge` | `ag` (alias: `aegis`) |
| MCP setup | `npx aegis-bridge mcp` | `ag mcp` |

The old `aegis-bridge` package is deprecated but remains available on npm. It will not receive updates.

---

## Step-by-Step Migration

### 1. Uninstall the Old Package

```bash
npm uninstall -g aegis-bridge
```

### 2. Install the New Package

```bash
npm install -g @onestepat4time/aegis
```

### 3. Verify Installation

```bash
ag --version
```

### 4. Update MCP Configuration

If you use Claude Code with the MCP integration:

```bash
# Remove old MCP config
claude mcp remove aegis

# Add new MCP config
claude mcp add aegis -- ag mcp
```

### 5. Update Scripts and CI

Search your codebase for references to `aegis-bridge`:

```bash
grep -r "aegis-bridge" --include="*.yml" --include="*.yaml" --include="*.json" --include="*.sh" --include="*.md" .
```

Replace all occurrences:

- `npx aegis-bridge` → `npx --package=@onestepat4time/aegis ag`
- `npm install aegis-bridge` → `npm install @onestepat4time/aegis`
- `aegis-bridge` (as CLI command) → `ag` (or `aegis` if you prefer the legacy alias)

### 6. Update Docker Images

```dockerfile
# Before
RUN npm install -g aegis-bridge
CMD ["aegis-bridge"]

# After
RUN npm install -g @onestepat4time/aegis
CMD ["ag"]
```

### 7. Update systemd Services

```ini
# Before
ExecStart=/usr/bin/aegis-bridge

# After
ExecStart=/usr/bin/env ag
```

---

## API Compatibility

The REST API is **fully backward compatible**. No endpoint paths, request/response formats, or behaviors have changed. If you interact with Aegis via HTTP API only (no CLI or npm), no migration is needed.

---

## Configuration Files

No configuration file changes are required. `aegis.config.json` works identically with the new package.

---

## Rollback

If you need to rollback to the old package:

```bash
npm uninstall -g @onestepat4time/aegis
npm install -g aegis-bridge@latest
claude mcp remove aegis
claude mcp add aegis -- npx aegis-bridge mcp
```

> The old package will not receive updates after v0.2.0-alpha. Rollback should be temporary only.

---

## Need Help?

- [GitHub Issues](https://github.com/OneStepAt4time/aegis/issues)
- [Discord](https://discord.com/invite/clawd)

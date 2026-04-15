# Windows Development Guide

This guide covers developing and debugging Aegis on Windows.

## Windows-Specific Issues

### Content-Length CRLF Mismatch

**Symptom:** `POST /v1/sessions/:id/send` fails with Content-Length mismatch on Windows.

**Root cause:** When sending multi-line content, the server calculates `Content-Length` using `string.length` which counts UTF-16 code units for string data, but the actual body bytes use `Buffer.byteLength()` which correctly handles byte length. On Windows with CRLF line endings, these can differ.

**Fix:** Always use `Buffer.byteLength()` instead of `string.length` when calculating Content-Length for request bodies. For the full fix details, see PR #1766 (pending merge).

**Workaround for testing:** Use Linux/macOS runners for CI where possible. The issue primarily affects Windows psmux environments.

### Line Ending Conversion

Windows uses CRLF (`\r\n`) for line endings, while Unix uses LF (`\n`). This can cause:

- **JSONL transcript parsing** — lines may include trailing `\r`
- **Tmux command injection** — CRLF in commands can be interpreted as command terminators
- **Shell expansion differences** — PowerShell vs bash have different expansion rules

**Mitigation:**
- Use `Buffer.byteLength()` for all byte-length calculations
- Strip trailing `\r` when parsing JSONL lines
- Use `String.replace(/\r\n/g, '\n')` before sending multi-line content

### psmux vs tmux

Aegis supports both tmux (Linux/macOS) and psmux (Windows). Key differences:

| Feature | tmux | psmux |
|---------|------|-------|
| Socket path | `/tmp/tmux-*` | `\\.\pipe\psmux-*` |
| Command separator | `;` | `&&` |
| Line ending | LF | CRLF |
| Signal handling | SIGWINCH, SIGUSR1 | Console events |

When debugging, check which runner is active:
```bash
curl http://localhost:9100/v1/health
# Look for "runner" field: "tmux" or "psmux"
```

## Development Setup on Windows

### Prerequisites

1. **Node.js 20+** — use [nvm-windows](https://github.com/coreybutler/nvm-windows) or install directly
2. **psmux** — see [Windows Setup](./windows-setup.md) for installation via Chocolatey/winget/scoop
3. **Git** — configure for Windows:
   ```powershell
   git config --global core.autocrlf input
   ```
   This prevents Git from automatically converting line endings.

### Running Tests

```powershell
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npx vitest run src/__tests__/session.test.ts

# Debug a specific test
npx vitest run --reporter=verbose src/__tests__/session.test.ts
```

### Common Windows Issues

#### Socket Path Issues

psmux uses Windows named pipes instead of Unix sockets. If you see:

```
Error: connect ECONNREFUSED /tmp/tmux-1000/default
```

This means Aegis is trying to use tmux but only psmux is available. Configure Aegis to use psmux:

```bash
AEGIS_RUNNER=psmux npm run dev
```

#### PowerShell Path Expansion

When running shell commands via `execSync`, PowerShell handles path expansion differently than bash:

```typescript
// Unix
execSync('ls ~/projects/*')

// Windows (PowerShell) — must use different syntax
execSync('dir $env:USERPROFILE\\projects\\*')
```

Aegis abstracts this in `src/tmux.ts` and `src/psmux.ts`. If you add new shell commands, test on both platforms.

#### Git Line Ending Issues

If tests pass locally but fail in CI, check line endings:

```powershell
# Check if line endings are causing issues
git log --oneline --graph --all
git diff HEAD origin/develop

# Force consistent line endings
git add --renormalize .
git commit -m "chore: normalize line endings"
```

## CI on Windows

GitHub Actions Windows runners use `powershell` (not bash). Key differences:

- **Path separator** — use `\` in PowerShell, but GitHub Actions uses bash-like shell
- **Environment variables** — PowerShell: `$env:VAR`, bash: `$VAR`
- **Command chaining** — PowerShell: `;`, bash: `;`

The `package.json` scripts handle this cross-platform. If you add new scripts, verify they work on both:

```powershell
# Test on Windows locally
npm run build
npm run test:smoke
```

## Reporting Windows Bugs

When reporting Windows-specific issues:

1. Include the output of `curl http://localhost:9100/v1/health`
2. Note the runner type (tmux or psmux)
3. Provide the full error message including stack trace
4. Specify Windows version and Node.js version
5. Tag the issue with `platform: windows`

## CI Development on Windows

When developing Aegis CI workflows on Windows, be aware of these platform differences:

### YAML Quoting in GitHub Actions

GitHub Actions uses YAML for workflow definitions. On Windows runners, string values containing special characters need careful quoting:

```yaml
# Wrong — special characters can break YAML parsing
script: npm run security-check -- --verbose

# Correct — explicit quoting
script: "npm run security-check -- --verbose"

# Multi-line scripts on Windows (use | not >)
run: |
  npm install
  npm run build
  npm test
```

### Node.js Script Extensions (.cjs vs .mjs)

Node.js determines module format by file extension:

| Extension | Module Type |
|----------|------------|
| `.cjs` | CommonJS (require) |
| `.mjs` | ES Modules (import) |
| `.js` | Inferred from `package.json` `"type"` field |

**Rule:** If a script uses `require()`, name it `.cjs`. If it uses `import`, name it `.mjs`.

```javascript
// security-check.cjs — uses CommonJS
const { execSync } = require('child_process')
const fs = require('fs')

// WRONG: security-check.js with "type": "module" in package.json
// RIGHT: security-check.cjs when package.json has "type": "module"
```

### Git Line Endings on Windows

Set `core.autocrlf` before cloning:

```powershell
git config --global core.autocrlf input
git clone https://github.com/OneStepAt4time/aegis.git
```

This prevents Git from converting LF to CRLF on checkout, which can cause:
- `#!/bin/bash` scripts to fail (Windows sees `\r\n` as part of the command)
- JSONL parsing issues when `\r` appears in data files
- Test failures that only appear on CI

### PowerShell Encoding

PowerShell scripts saved with Windows encoding (UTF-16) can break. Always save scripts as UTF-8:

```powershell
# VS Code: bottom-right encoding selector → UTF-8
# Or via command line:
[System.IO.File]::WriteAllText("script.ps1", $content, [System.Text.UTF8Encoding]::new($false))
```

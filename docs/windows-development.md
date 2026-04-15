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

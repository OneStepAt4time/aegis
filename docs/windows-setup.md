# Windows Setup

This guide covers running Aegis natively on Windows for local development and CI-like verification.

## Prerequisites

- Node.js 20+ (Node.js 22 recommended)
- npm 10+
- Claude Code CLI installed and authenticated
- psmux installed (tmux-compatible process manager for Windows)

## Install Options

Choose one package manager for psmux:

### Option A: Chocolatey

```powershell
choco install psmux -y
```

### Option B: winget

```powershell
winget install psmux
```

### Option C: Scoop

```powershell
scoop install psmux
```

Install Aegis dependencies:

```powershell
git clone https://github.com/OneStepAt4time/aegis.git
cd aegis
npm ci
npm run build
```

## Verification

Build, typecheck, and run tests:

```powershell
npx tsc --noEmit
npm run build
npm test
```

Run a smoke check for the health endpoint:

```powershell
$proc = Start-Process -FilePath node -ArgumentList 'dist/cli.js','--port','9100' -PassThru
node scripts/ci-smoke-health.mjs
Stop-Process -Id $proc.Id -Force
```

Expected health payload includes platform:

```json
{
  "status": "ok",
  "version": "2.x.x",
  "platform": "win32"
}
```

## Troubleshooting

- If Aegis exits at startup with tmux not found, verify psmux is installed and available in PATH.
- If health checks time out, ensure port 9100 is not blocked by local firewall software.
- If Claude sessions fail to launch, run claude --version and confirm CLI auth status.
- If npm install or build fails due to antivirus locks, retry after excluding the repo temp/build folders.

## Known Limitations and psmux Caveats

- psmux is tmux-compatible but not a byte-for-byte replacement; subtle behavior differences can surface in pane timing and process metadata.
- Path handling differs on Windows (drive letters, backslashes); prefer normalized paths in tests and scripts.
- Some shell snippets written for POSIX tools (grep, awk, find) are not portable; use PowerShell alternatives in Windows-specific scripts/workflows.
- CI and local verification should always include a real /v1/health smoke check to catch platform drift early.

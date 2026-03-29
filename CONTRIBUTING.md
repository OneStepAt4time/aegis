# Contributing to Aegis

Thank you for your interest in contributing to Aegis! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **tmux** ≥ 3.2
- **Claude Code** installed and authenticated

### Getting Started

```bash
git clone https://github.com/OneStepAt4time/aegis.git
cd aegis
npm ci
npm run build
npm test
```

### Running Locally

```bash
# Start the server
npm start

# Or with auto-rebuild
npm run dev
```

### Dashboard Development

```bash
cd dashboard
npm ci
npm run dev
```

## Branch Naming

Use descriptive branch names with prefixes:

- `feat/<description>` — new features
- `fix/<description>` — bug fixes
- `docs/<description>` — documentation changes
- `chore/<description>` — maintenance, CI, tooling
- `refactor/<description>` — code restructuring
- `test/<description>` — test additions/improvements
- `perf/<description>` — performance improvements

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). PR titles **must** follow this format:

```
<type>: <description>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Examples:**
- `feat: add session templates API`
- `fix: prevent path traversal in workDir validation`
- `docs: update MCP tool reference`

Breaking changes: add `!` after type — `feat!: redesign session lifecycle`

## Pull Request Process

1. **Fork and branch** from `main`
2. **Write code** — follow existing patterns and style
3. **Add tests** — all new features need test coverage
4. **Run checks locally:**
   ```bash
   npx tsc --noEmit       # TypeScript
   npm run build           # Build
   npm test                # Tests
   npm audit --audit-level=high  # Security
   ```
5. **Open PR** — fill out the template, link related issues
6. **Address review feedback** — CI must pass, 1 approval required

### PR Requirements

- Squash merge only (enforced)
- CI must pass (tsc, build, test, audit)
- 1 approval from CODEOWNERS required
- Branch must be up-to-date with `main`
- Conventional commit title required

## Code Style

- TypeScript strict mode
- No `any` types (use `unknown` + type guards)
- Zod validation for all API inputs
- Async/await over raw promises
- Error messages should be actionable

## Testing

- **Unit tests**: Co-located with source in `__tests__/`
- **Framework**: Vitest
- **Run**: `npm test` (or `npx vitest run`)
- **Dashboard tests**: `cd dashboard && npx vitest run`

## Security

Found a vulnerability? **Do not open a public issue.** See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Questions?

Open a [discussion](https://github.com/OneStepAt4time/aegis/discussions) or check existing [issues](https://github.com/OneStepAt4time/aegis/issues).

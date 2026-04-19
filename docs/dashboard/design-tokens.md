# Dashboard Design Tokens

> Source of truth for every color, spacing, radius, motion, and shadow used
> in the Aegis dashboard. Enforced by a grep gate wired into `npm run gate`.

Status: **Phase 1 foundation** — issue
[dashboard-perfection #016](../../.claude/epics/dashboard-perfection/016.md).

## Why

Before #016, raw hex literals (`#3b82f6`), rgb/rgba/hsl colors, and inline
`cubic-bezier(...)` strings were sprinkled through 27 component files. That
made theme changes, accessibility audits, and light/dark parity impossible
without chasing strings across the tree.

The tokens module fixes that at the root: one place to change blue, one place
to speed up an animation, one place to bump a corner radius.

## Files

| Path | Purpose |
|------|---------|
| `dashboard/src/design/tokens.ts` | TypeScript source of truth. Colors, spacing, radius, duration, easing, shadow, z-index. |
| `dashboard/src/design/motion.ts` | Framer Motion presets (seconds + cubic-bezier tuples) built from `tokens`. |
| `dashboard/src/index.css` | CSS custom-property mirror. Motion vars live in the `@theme { ... }` block. |
| `scripts/dashboard-tokens-gate.cjs` | Grep gate. Fails CI on raw hex/rgb/hsl/cubic-bezier/`duration-<n>`. |
| `scripts/dashboard-tokens-gate.allowlist.txt` | Migration scaffolding — files that still violate. Shrinks over time. |

## Importing

The dashboard does not use a path alias; use relative imports from anywhere
under `dashboard/src/`:

```ts
import { tokens } from '../design/tokens.js';
import { motion, framerEasing } from '../design/motion.js';
```

Use the ESM `.js` extension as required by the project TypeScript conventions.

### Example — inline style

```tsx
import { tokens } from '../../design/tokens.js';

export function Badge() {
  return (
    <span
      style={{
        color: tokens.color.danger,
        padding: tokens.spacing.sm,
        borderRadius: tokens.radius.md,
      }}
    >
      Error
    </span>
  );
}
```

### Example — Framer Motion

```tsx
import { motion as framer } from 'framer-motion';
import { motion } from '../../design/motion.js';

<framer.div
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={motion.enter}
/>
```

### Example — CSS custom properties

Use the mirrored variables directly inside CSS or Tailwind arbitrary values:

```css
.my-card {
  transition: transform var(--duration-base) var(--ease-standard);
  border-radius: var(--radius-lg);
}
```

## The gate

`npm run gate` invokes `npm run dashboard:tokens:gate`, which runs
`scripts/dashboard-tokens-gate.cjs`. The gate scans
`dashboard/src/components/**` and `dashboard/src/pages/**` for:

- Hex color literals (`#rgb`, `#rrggbb`, `#rrggbbaa`)
- `rgb(`, `rgba(`, `hsl(`, `hsla(` literals
- Raw `cubic-bezier(` literals
- Tailwind `duration-<n>` classes (e.g. `duration-200`, `duration-[320ms]`)

### Exceptions

- Files under `dashboard/src/design/` are the source of truth and are always
  skipped.
- Lines containing `// token-ok` or `{/* token-ok */}` are treated as
  intentional — use only for genuinely unavoidable cases (e.g. an xterm theme
  object). Keep them rare and comment **why**.
- Files listed in `scripts/dashboard-tokens-gate.allowlist.txt` are
  grandfathered in. Follow-up PRs remove entries one component at a time
  as the migration progresses.

### Regenerating the allowlist

Only run this after you've intentionally migrated files and want to rebase
the allowlist. The resulting diff will usually **remove** entries, never add:

```bash
node scripts/dashboard-tokens-gate.cjs --write-allowlist
```

The command rewrites the allowlist with every currently-violating file.

## Migrating a component (recipe)

1. Remove the component from `scripts/dashboard-tokens-gate.allowlist.txt`.
2. `node scripts/dashboard-tokens-gate.cjs` — read the violations.
3. Replace literals:
   - `#3b82f6` → `tokens.color.accent`
   - `rgba(0,0,0,0.5)` → compose from tokens or reference a
     `--color-*` CSS var.
   - `cubic-bezier(0.2, 0, 0, 1)` → `tokens.easing.standard` / `motion.base`.
   - `duration-200` → inline `style={{ transitionDuration: \`${tokens.duration.base}ms\` }}`
     or `className={\`transition-[all_var(--duration-base)_var(--ease-standard)]\`}`.
4. Re-run the gate until it passes.
5. Commit with `refactor(dashboard): migrate <ComponentName> to design tokens`.

## Rules of thumb

- New components must use tokens from day one — do **not** add to the allowlist.
- Never inline a hex color in JSX/TSX. If you need a one-off, add it to
  `tokens.color.*` first.
- Every animation in Framer Motion pulls from `motion.*`; every CSS transition
  uses `var(--duration-*)` + `var(--ease-*)`.
- Semantic action colors (`kill` / `revoke` / `reject` = danger;
  `approve` / `create` = success) live under `tokens.action.*`.

## Related

- Issue [016](../../.claude/epics/dashboard-perfection/016.md) — the epic-level
  plan for primitives, Storybook, and visual regression.
- `dashboard/src/index.css` — CSS layer (colors, helper classes, noise
  overlay, nav indicators).

# TypeScript Conventions

## Types

- ❌ Never use `any` — use `unknown` + type guards
- ❌ Never use `as` casts without justification
- ✅ Use explicit return types on exported functions
- ✅ Use `interface` for object shapes, `type` for unions/intersections

## Imports

- Use `.js` extensions in imports (ESM): `import { foo } from './bar.js'`
- Absolute imports from `src/` for cross-module references

## Error Handling

- Validate inputs at route handlers, not deep in business logic
- Use structured error objects, not raw strings
- Redact auth tokens from logs (handled by server middleware)

## Testing

- Test files go in `src/__tests__/`
- Use Vitest `describe`/`it` blocks
- Test file naming: `<module>.test.ts`
- Integration tests should test via HTTP API, not internal functions

## Design Patterns

### Internal-mutable / external-readonly Map (issue #4779)

When a module owns a Map whose mutation has non-obvious invariants (e.g. a `.finally(() => delete)` cleanup that only works if external callers never insert entries), expose a **read-only view** to consumers and keep the **mutable map** as a private field. Enforce the producer/consumer split at compile time.

Shape:

```ts
// Producer (owning module — AcpBackend)
private readonly pendingHandshakesInternal = new Map<string, PendingHandshake>();
private readonly pendingHandshakes: ReadonlyMap<string, PendingHandshake> =
  this.pendingHandshakesInternal;

// ...mutations only via `pendingHandshakesInternal`:
this.pendingHandshakesInternal.set(session.id, { session, backendRunId, ready });
.finally(() => { this.pendingHandshakesInternal.delete(session.id); });

// Consumer (PromptDeps and beyond)
export interface PromptDeps {
  // ...
  pendingHandshakes: ReadonlyMap<string, PendingHandshake>;
}
```

**Anchoring the boundary in the acp backend (post-#4779):**

- **Producer:** `launchBackgroundHandshake` in `src/services/acp/backend.ts` — the only `.set` / `.delete` callsite, and the only caller of `pendingHandshakesInternal`. Keep the producer's mutations behind a single function so the surface stays auditable.
- **Consumer:** `PromptDeps.pendingHandshakes` in `src/services/acp/backend/prompts.ts` — read-only access via `.get` / `.has`. New consumers see the readonly view, not the mutable field, by construction (the mutable field is `private`).

Why two fields, not a single `ReadonlyMap` assignment? A single `readonly` field declared `ReadonlyMap` still has a mutable identity — TypeScript only narrows the declared type. The producer needs a real `Map` reference to call `.set` / `.delete`; the external view is a structural alias of the same object. Splitting into two fields (mutable internal + readonly public) makes the producer the only path that compiles the mutator calls, and the type system prevents external code from re-introducing them.

**Test the contract, not the runtime.** Use Vitest's `expectTypeOf` to assert the public type lacks the mutator methods:

```ts
expectTypeOf<PromptDeps['pendingHandshakes']>().not.toHaveProperty('set');
expectTypeOf<PromptDeps['pendingHandshakes']>().not.toHaveProperty('delete');
expectTypeOf<PromptDeps['pendingHandshakes']>().not.toHaveProperty('clear');
// Read-only methods must still exist:
expectTypeOf<PromptDeps['pendingHandshakes']>().toHaveProperty('get');
expectTypeOf<PromptDeps['pendingHandshakes']>().toHaveProperty('has');
```

If a future refactor widens `pendingHandshakes` back to `Map<…>`, the type-level assertions fail at `tsc` time — not at code-review time, not at runtime. The regression test makes the contract explicit.

Canonical example: `src/services/acp/backend/types.ts` (`PendingHandshake` named type, post-#4779) and `src/__tests__/acp-pendinghandshakes-readonly-4779.test.ts` (the `expectTypeOf` regression test).

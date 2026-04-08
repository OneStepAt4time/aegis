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

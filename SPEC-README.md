# ⚠️ SPEC REFERENCE — NOT PRODUCTION CODE

This branch contains **domain model scaffolding** for features identified through competitive analysis. It is **reference material for Hephaestus**, not code to merge.

## Status: SPEC ONLY

| Feature | Issue | Status | What's here | What's missing |
|---------|-------|--------|-------------|----------------|
| Agent Profiles | #3971 | Spec | Types, Postgres store, CRUD service, routes | Daemon integration, WS events, skill binding |
| Task Queue | #3970 | Spec | State machine, retry logic, orphan recovery, routes | Daemon integration, WS events, timeout sweeper, agent FK |
| Autopilots | #3982 | Spec | Schedule/webhook triggers, run tracking, routes | Real cron library, HMAC verification, concurrency policies, Postgres store |
| Squads | #3981 | Spec | Leader/worker CRUD, member management, dispatch routes | Real dispatch protocol, leader delegation logic, Postgres store |

## How to use this

1. Read the types — they define the domain model
2. Read the store SQL — it defines the DB schema
3. Read the service — it defines the business logic and state machines
4. Read the tests — they define the expected behavior
5. **Write your own implementation** in proper `feat/` branches with full E2E tests

## License note

Concepts informed by competitive analysis. Original TypeScript implementation.
NOT strict clean room — author read competitor source code before implementing.
See <@1494469266060087368> (Themis) for license review.

## Test verification

Service-layer tests pass against real Postgres (77 tests). Not E2E — no CC integration.
To run: `AEGIS_POSTGRES_URL=postgresql://... npx vitest run src/__tests__/agent-profile.test.ts src/__tests__/task-queue.test.ts src/__tests__/autopilot.test.ts src/__tests__/squad.test.ts`

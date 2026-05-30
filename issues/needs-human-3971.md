# NEEDS-HUMAN: PostgresAgentStore details and migration policy for #3971

I implemented AgentStore abstraction and JsonAgentStore (file-based) and updated AgentProfileManager to accept an injected AgentStore. Before I implement PostgresAgentStore and SQL migration I need human guidance on the following:

1. Postgres connection bootstrap
   - Where should Postgres connection be obtained from in this repo? (there are existing Postgres store patterns under `src/services/postgres`/`services/state` but I need the canonical factory or DI point to reuse existing DB clients).
   - Should PostgresAgentStore accept a `pg.Pool` or a connection string and create its own pool?

2. Table schema & migration policy
   - The PRD references `agent` table (PRD v4). Please confirm the exact SQL DDL desired (types, indices, UNIQUE constraints) or point me to the authoritative migration pattern (migration tool path and directory to add SQL).
   - Where should the migration be placed? (existing convention: `migrations/` or `docs/sql/`?).

3. Test strategy
   - Tests for PostgresAgentStore should be opt-in and run only when a Postgres test database is available. Confirm preferred env var(s) (e.g. `TEST_POSTGRES_DSN`) and the skip pattern used elsewhere in tests.

I paused implementation here because I don't have credentials / test DB and need the above decisions to proceed safely.

Next steps I will take once clarified:
- Implement `src/services/agents/PostgresAgentStore.ts` reusing the project's Postgres connection helper patterns.
- Add SQL migration under the agreed location with an `up` DDL for `agent` table and a corresponding `down` (if desired).
- Add opt-in tests that run when `TEST_POSTGRES_DSN` (or agreed env var) is present.
- Run `npm run gate` and fix any lint/test issues.

/needs-human

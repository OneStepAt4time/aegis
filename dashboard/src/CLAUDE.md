# dashboard/src/ — Aegis React Dashboard

Single-page React dashboard for monitoring and interacting with Aegis sessions.

## Stack

- **React 19** + **React Router 7** (lazy-loaded routes)
- **TypeScript** strict mode
- **Vite** for dev/build
- **Zustand** for state management (`store/useStore.ts`)
- **Zod** for API response validation (`api/schemas.ts`)
- **TanStack React Virtual** for large session lists
- **Tailwind CSS** for styling (utility classes in `index.css`)

## Architecture

```
dashboard/src/
├── App.tsx            # Root component with lazy-loaded routes
├── main.tsx           # Entry point, renders App into DOM
├── api/               # API client layer
│   ├── client.ts      # REST + SSE + WebSocket client
│   ├── schemas.ts     # Zod schemas for API responses
│   ├── resilient-eventsource.ts  # SSE with auto-reconnect
│   └── resilient-websocket.ts    # WebSocket with backoff
├── components/        # Shared UI components
│   ├── overview/      # Session list, metric cards, status dots
│   ├── session/       # Session detail view, live terminal, transcript
│   ├── pipeline/      # Pipeline status badges
│   └── metrics/       # Latency panels
├── hooks/             # Custom React hooks (polling, SSE awareness)
├── pages/             # Route-level page components
├── store/             # Zustand stores (useStore, useToastStore)
├── types/             # TypeScript type definitions
└── utils/             # Formatting utilities
```

### Key patterns

- **Lazy loading** — all page components use `React.lazy()` + `Suspense`. Code-split per route.
- **Optimistic updates** — store updates before API responses arrive, rollback on error.
- **SSE + polling hybrid** — `useSseAwarePolling.ts` uses SSE when connected, falls back to polling.
- **Zod validation at API boundary** — all API responses validated through schemas before hitting the store.
- **Zustand for global state** — no prop drilling. Stores are flat, not nested.
- **Error boundary** — catches render errors at the route level.

### API communication

All backend calls go through `api/client.ts`. The client handles:
- Base URL from `import.meta.env.VITE_API_URL` or defaults to `window.location.origin`
- SSE via `resilient-eventsource.ts` (auto-reconnect with backoff)
- WebSocket via `resilient-websocket.ts` (for live terminal streaming)
- Zod schema validation on all responses

## Conventions

- **Functional components only** — no class components.
- **Named exports** — prefer `export function Component()` over default exports (exception: lazy-loaded pages use default export).
- **Tailwind utilities** — use Tailwind classes directly. No custom CSS modules.
- **Types from API schemas** — derive types from Zod schemas using `z.infer<>`, don't duplicate.
- **No `any`** — use `unknown` + type narrowing.

## Testing

- Tests live in `dashboard/src/__tests__/`.
- Dashboard build: `npm run build:dashboard` (from repo root).
- The dashboard is compiled and copied into `dist/dashboard/` for serving by the Aegis server.

## Common pitfalls

- Dashboard is served as static files by the Aegis server — no separate deployment.
- API client base URL must be configurable for dev vs production (Vite env vars).
- WebSocket connections for live terminal need the session ID in the URL path.
- SSE events may arrive out of order — handle idempotently using event IDs.

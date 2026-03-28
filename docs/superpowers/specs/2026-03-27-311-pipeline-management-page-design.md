# Pipeline Management Page — Design Spec

**Issue:** #311
**Date:** 2026-03-27
**Scope:** Frontend only — backend API already exists

## Overview

Add a Pipelines page to the dashboard with list view, detail view, and create form. The sidebar already has a placeholder nav item. API client functions (`createPipeline`, `getPipelines`, `getPipeline`) and types (`PipelineRequest`, `PipelineInfo`) already exist.

## Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/pipelines` | `PipelinesPage` | Pipeline list + create trigger |
| `/pipelines/:id` | `PipelineDetailPage` | Pipeline detail with session steps |

## Components

### PipelinesPage (`pages/PipelinesPage.tsx`)

- Header: "Pipelines" title + "New Pipeline" button (opens `CreatePipelineModal`)
- MetricCards row: total, running, completed, failed counts
- Pipeline cards/rows: name, status badge, session count, created time
- Click card → navigate to `/pipelines/:id`
- Empty state when no pipelines exist
- Interval polling every 5s (matches `SessionTable` pattern)

### PipelineDetailPage (`pages/PipelineDetailPage.tsx`)

- Breadcrumb: "Pipelines" link → pipeline name
- Header: pipeline name + status badge + created time
- Session steps table: order #, name, workDir, status (`StatusDot`), prompt preview
- Click session row → navigate to `/sessions/:id`
- 404 state with back link
- Interval polling every 3s

### CreatePipelineModal (`components/CreatePipelineModal.tsx`)

- Follows `CreateSessionModal` patterns: backdrop, focus trap, escape-to-close
- Fields: pipeline name (required), dynamic step list
- Each step: workDir (required), name (optional), prompt (optional textarea)
- Add/remove step buttons
- Submit calls `createPipeline()`, navigates to `/pipelines/:id` on success
- Loading state during submission, error toast on failure

## Sidebar Update

Move Pipelines from placeholder section into `NAV_ITEMS` array:
```ts
{ to: '/pipelines', label: 'Pipelines', icon: Activity }
```

## Status Handling

Pipeline `status` is `string` from API. Display mapping:

| Status | Badge | Color |
|--------|-------|-------|
| `running` | Pulse badge | Cyan |
| `completed` | Static badge | Green |
| `failed` | Static badge | Red |
| `pending` | Static badge | Gray |
| unknown | Static badge | Gray |

## Polling Strategy

- List page: 5s interval via `useEffect` + `setInterval` (matches `SessionTable`)
- Detail page: 3s interval (more frequent for active monitoring)
- Both use `useCallback` for memoized fetch functions
- Polling stops on unmount via cleanup

## Tests

- `PipelinesPage.test.tsx`: renders list, empty state, polling, create button opens modal
- `PipelineDetailPage.test.tsx`: renders detail, session table, back navigation, 404 state
- `CreatePipelineModal.test.tsx`: form validation, add/remove steps, submit flow

## Files Changed

| File | Action |
|------|--------|
| `dashboard/src/pages/PipelinesPage.tsx` | New |
| `dashboard/src/pages/PipelineDetailPage.tsx` | New |
| `dashboard/src/components/CreatePipelineModal.tsx` | New |
| `dashboard/src/App.tsx` | Add routes |
| `dashboard/src/components/Layout.tsx` | Activate sidebar nav |
| `dashboard/src/__tests__/PipelinesPage.test.tsx` | New |
| `dashboard/src/__tests__/PipelineDetailPage.test.tsx` | New |
| `dashboard/src/__tests__/CreatePipelineModal.test.tsx` | New |

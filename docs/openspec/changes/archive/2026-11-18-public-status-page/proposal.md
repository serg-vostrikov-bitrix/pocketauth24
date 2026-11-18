## Why

An operator cannot see the state of b24auth-server without reading logs. `/health` always returns `{"status":"ok"}`, also when PostgreSQL is down, and the server keeps no record of event delivery. This change gives the service a public status page at `/` and makes `/health` report the database state.

This is item 1 of 2 of backlog issue #6 (sub-issue #7). Item 2, `admin-panel`, builds on the frontend skeleton from this change.

## What Changes

- Add a React single-page application (built with Vite) to the repository. Fastify serves the built files from the same container.
- Show a public status page at `/`: service health, database health and aggregate statistics.
- Use a dark, calm, high-tech visual style with subtle animations. The status page shows a continuous "gyroscope" animation: nested glowing rings that rotate at different speeds around different axes.
- Add `GET /api/status`, a public JSON endpoint with the same data.
- `/health` checks the database. If the database does not answer, `/health` returns HTTP 503. **BREAKING** for monitors that expect HTTP 200 in all cases.
- Count event delivery outcomes (delivered, failed, dropped) per UTC day in a new table. The table stores counts only, no event content.

## Capabilities

### New Capabilities

- `service-status`: health check with a database probe, the public status endpoint and the public status page.

### Modified Capabilities

- `event-delivery`: the server records the outcome of each delivery attempt in daily counters.

## Impact

- New directory `web/` with the React application, its own `package.json` and a Vite build.
- `Dockerfile`: a build step for the frontend; the runtime image contains the built files.
- New dependency `@fastify/static` on the server.
- New table `event_counters` and a Drizzle migration.
- `src/app.ts` (routes), `src/methods/events.ts` (counters), new `src/status.ts`.
- `docs/deployment.md`: the proxy must allow `/`, `/assets/*` and `/api/status`; describe the new `/health` behavior.

## Non-goals

- Admin panel, authentication and sessions (change `admin-panel`).
- Per-portal or per-application data on the public page.
- Storage of event content or a per-event log.

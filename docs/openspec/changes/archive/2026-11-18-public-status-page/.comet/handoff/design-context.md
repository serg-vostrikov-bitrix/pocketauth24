# Comet Design Handoff

- Change: public-status-page
- Phase: design
- Mode: compact
- Context hash: 581c48e48ae497461035d83c7bfc31e76ebff7dacd3f08c7543c4e00e6f06421

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/public-status-page/proposal.md

- Source: docs/openspec/changes/public-status-page/proposal.md
- Lines: 1-39
- SHA256: 1f5fd3d31ff86cc3014b8c64fe04a604c34c99994e7e8e6a4de8e46efda0d0db

```md
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

```

## docs/openspec/changes/public-status-page/design.md

- Source: docs/openspec/changes/public-status-page/design.md
- Lines: 1-71
- SHA256: 5359b54c8c5d76f0b686e498fded82b3be898ff2db0c2176c993bb4155fd41fb

```md
## Context

b24auth-server is one Fastify 5 process with PostgreSQL 17 and Drizzle. It has no frontend and no build step other than `tsc`. It often runs in a closed network, so the UI must load nothing from the internet. `/health` returns a static `{"status":"ok"}`. Event delivery is fire-and-forget and leaves only log lines.

The user chose a React single-page application for the UI. The admin panel (change `admin-panel`) will reuse the same frontend skeleton.

## Goals / Non-Goals

**Goals:**
- One frontend project that serves the status page now and the admin panel later.
- A public page and JSON endpoint with health and aggregate statistics.
- A `/health` that fails when the database fails.
- Daily event outcome counters with no personal or secret data.

**Non-Goals:**
- Authentication, admin routes, per-tenant views.
- Charts or historical series older than 7 days on the page.

## Decisions

### D1. Frontend in `web/`, built by Vite, served by `@fastify/static`
`web/` holds a separate `package.json` (React, Vite, TypeScript). `npm run build` in `web/` writes to `web/dist`. The Dockerfile builds it in the build stage and copies `web/dist` to `/app/public`. Fastify registers `@fastify/static` on `/` with `wildcard: false` and serves `index.html` for `/`.

- Alternative: one `package.json` for server and web. Rejected: server production dependencies would mix with React build tooling, and `npm prune --omit=dev` becomes harder to reason about.
- Alternative: server-rendered HTML. The user rejected it in favor of React.

The JSON 404 handler stays. Client-side routing for `/admin/*` is a decision of `admin-panel`.

### D2. No UI library, plain CSS
The page has a few cards and numbers. A component library adds weight and update work for no gain. CSS uses system fonts, so the page loads no web fonts.

### D2a. Visual style: design tokens in CSS custom properties
One `theme.css` defines the dark palette (deep navy or graphite background, one cool accent such as cyan, one error color), spacing, radii and transition durations as CSS custom properties. The admin panel reuses the same file. Animations are CSS transitions and keyframes only. A `@media (prefers-reduced-motion: reduce)` block turns them off.

### D2b. Gyroscope: CSS 3D transforms
The gyroscope is a React component with 3 to 5 nested rings. Each ring is an element with a border and a `box-shadow` / `drop-shadow` glow. Each ring has its own `@keyframes` rotation in 3D (`rotateX`, `rotateY`, `rotateZ`) with its own duration, inside a parent with `perspective` and `transform-style: preserve-3d`. Only `transform` and `opacity` animate, so the browser composites on the GPU without layout work. The accent color comes from a CSS variable, so the component switches to the error color through one class.

- Alternative: Three.js or another WebGL library. Rejected: about 150 KB more for an effect that CSS gives at no cost.
- Alternative: canvas with a JavaScript loop. Rejected: more code and CPU use for the same result.

### D3. `GET /api/status` with a 10-second in-memory cache
Statistics use `count(*)` on three small tables plus a sum over `event_counters`. The endpoint is public, so a cache bounds the database load from repeated calls. The database probe for `database` status reuses the same computation. The cache lives in the process; one instance is the supported deployment.

### D4. `/health` probe: `SELECT 1` with a 2-second timeout
The probe races the query against a 2-second timer. On timeout or error, respond with HTTP 503. `/health` is not cached, so monitors see the current state.

### D5. Table `event_counters (day date, outcome text, count bigint, PK(day, outcome))`
`deliver()` calls `INSERT ... ON CONFLICT (day, outcome) DO UPDATE SET count = count + 1` after each outcome, without `await` on the delivery path, and logs a failure. Three rows per day, so no retention job is necessary.

- Alternative: a per-event log table. The user chose counters only: no content, small size.
- Alternative: in-memory counters. Rejected: they reset on restart.

### D6. Version from `package.json`
The server reads `version` from `package.json` at boot and returns it in `/api/status`. No uptime: nobody asked for it.

## Risks / Trade-offs

- [`/health` now returns 503 when the database is down] → Docker healthchecks and monitors restart or alert correctly. Document the change in `docs/deployment.md`.
- [Public counts show the scale of the installation] → Counts only, no hosts or IDs. The proxy can restrict `/` and `/api/status` like other paths.
- [A second `package.json` adds a second dependency tree] → Dependabot must watch `web/` too; add it to `.github/dependabot.yml`.
- [Counter upsert adds one write per event] → One small upsert; it does not block the delivery.

## Migration Plan

1. Deploy the image. The server applies the Drizzle migration for `event_counters` at boot, as today.
2. Update the proxy to allow `/`, `/assets/*` and `/api/status` if it uses an allowlist.
3. Rollback: deploy the previous image. The extra table does no harm.

## Open Questions

- None blocking. The visual layout of the page is decided in the design phase.

```

## docs/openspec/changes/public-status-page/tasks.md

- Source: docs/openspec/changes/public-status-page/tasks.md
- Lines: 1-26
- SHA256: cae39898ebaba978c70bebd483d95b499e4fe513378dce926ccdfc50b7626955

```md
## 1. Event counters

- [ ] 1.1 Add the `event_counters` table to `src/schema.ts` and generate the Drizzle migration
- [ ] 1.2 Increment `delivered`, `failed` or `dropped` in `deliver()`; log a failed write
- [ ] 1.3 Integration tests for the three outcomes

## 2. Health and status API

- [ ] 2.1 `/health` with a `SELECT 1` probe and a 2-second timeout; HTTP 503 on failure
- [ ] 2.2 `src/status.ts`: statistics queries, 10-second cache, version
- [ ] 2.3 `GET /api/status` route
- [ ] 2.4 Integration tests: healthy, database down, cache, no sensitive fields

## 3. Frontend skeleton

- [ ] 3.1 Create `web/` with React, Vite and TypeScript; lint and typecheck scripts
- [ ] 3.2 `theme.css`: dark palette, accent and error colors, transition tokens, reduced-motion block
- [ ] 3.3 Gyroscope component: nested rings with 3D rotation, glow, error color state
- [ ] 3.4 Status page: health cards, statistics, subtle transitions, refresh every 30 seconds, no external resources
- [ ] 3.3 Serve `web/dist` with `@fastify/static` at `/`; keep the JSON 404

## 4. Build and docs

- [ ] 4.1 Dockerfile: build `web/` and copy the output into the runtime image
- [ ] 4.2 CI: build and lint `web/`; Dependabot entry for `web/`
- [ ] 4.3 Update `docs/deployment.md` and `README.md` (proxy paths, `/health` behavior, status page)

```

## docs/openspec/changes/public-status-page/specs/event-delivery/spec.md

- Source: docs/openspec/changes/public-status-page/specs/event-delivery/spec.md
- Lines: 1-16
- SHA256: 04895c2d295946fb08b72c5a529d44b38e7838f59d8bd28a33ed82e6663d91d0

```md
## ADDED Requirements

### Requirement: Count delivery outcomes
For each event item, the server SHALL increment one daily counter for the current UTC day: `delivered` when the handler responds with HTTP 2xx, `failed` when the handler responds with another status or the request fails, `dropped` when the in-flight cap rejects the item. The counters SHALL store no event content, handler URL, portal or application. A failure to write a counter SHALL NOT change the delivery and SHALL be logged.

#### Scenario: Successful delivery
- **WHEN** the handler of an event responds with HTTP 200
- **THEN** the `delivered` counter for the current UTC day increases by 1

#### Scenario: Handler error
- **WHEN** the handler responds with HTTP 500 or the request times out
- **THEN** the `failed` counter for the current UTC day increases by 1

#### Scenario: Overload
- **WHEN** the in-flight cap rejects an event item
- **THEN** the `dropped` counter for the current UTC day increases by 1

```

## docs/openspec/changes/public-status-page/specs/service-status/spec.md

- Source: docs/openspec/changes/public-status-page/specs/service-status/spec.md
- Lines: 1-74
- SHA256: 1a569f664f1f8a6653c87ccc8aad476e4cec85b7c814c6bd921a4a7d707092bb

```md
## ADDED Requirements

### Requirement: Health check includes the database
`GET /health` SHALL run a short query against PostgreSQL. If the query succeeds within 2 seconds, the server SHALL respond with HTTP 200 and `{"status":"ok"}`. Otherwise the server SHALL respond with HTTP 503 and `{"status":"error","database":"down"}`.

#### Scenario: Database is available
- **WHEN** a client calls `GET /health` and PostgreSQL answers
- **THEN** the server responds with HTTP 200 and `{"status":"ok"}`

#### Scenario: Database is not available
- **WHEN** a client calls `GET /health` and PostgreSQL does not answer within 2 seconds
- **THEN** the server responds with HTTP 503 and `{"status":"error","database":"down"}`

### Requirement: Public status endpoint
`GET /api/status` SHALL return JSON with: service status, database status, server version, the number of portals, the number of local applications, the number of active token pairs (refresh token not expired), and event delivery counts (delivered, failed, dropped) for the current UTC day and for the last 7 UTC days. The endpoint SHALL NOT require authentication.

#### Scenario: Status with a healthy database
- **WHEN** a client calls `GET /api/status` and PostgreSQL answers
- **THEN** the server responds with HTTP 200 and all fields listed above

#### Scenario: Status with a failed database
- **WHEN** a client calls `GET /api/status` and PostgreSQL does not answer
- **THEN** the server responds with HTTP 200, database status `down`, and null for every statistic

### Requirement: Public data contains no sensitive values
The status endpoint and the status page SHALL NOT expose secrets, token values, token hashes, `client_id` values, portal hosts, user IDs or handler URLs. They SHALL expose aggregate counts only.

#### Scenario: Response content
- **WHEN** a client reads the response of `GET /api/status`
- **THEN** the response contains no portal host, `client_id`, token, hash, user ID or URL

### Requirement: Statistics are cached
The server SHALL compute the statistics at most once in 10 seconds and SHALL serve the cached result between computations.

#### Scenario: Repeated requests
- **WHEN** a client calls `GET /api/status` 100 times within 10 seconds
- **THEN** the server runs the statistics queries at most once

### Requirement: Public status page
`GET /` SHALL return the status page. The page SHALL show the service and database state and the statistics from `GET /api/status`, and SHALL refresh them every 30 seconds. The page SHALL load no resources from outside the server.

#### Scenario: Operator opens the root URL
- **WHEN** a browser opens `/`
- **THEN** it shows the health state and the statistics without a login

#### Scenario: Closed network
- **WHEN** the browser has no internet access
- **THEN** the page loads completely, because all scripts, styles and fonts come from the server

### Requirement: Visual style
The UI SHALL use a dark theme. The style SHALL be calm and reliable and SHALL give an impression of high technology. Interface elements SHALL use short, subtle animations (for example, fade-in of cards and smooth changes of values). When the browser reports `prefers-reduced-motion: reduce`, the UI SHALL stop all non-essential animations.

#### Scenario: Default appearance
- **WHEN** a browser opens `/`
- **THEN** the page shows a dark background, light text and subtle transitions when the statistics refresh

#### Scenario: Reduced motion
- **WHEN** the operating system of the user requests reduced motion
- **THEN** the page shows the same content without animations

### Requirement: Gyroscope animation on the status page
The status page SHALL show a continuous animation of several nested circles. Each circle SHALL rotate at its own speed around its own axis in 3D, with a soft glow, like a futuristic gyroscope. The animation SHALL run on the GPU (CSS 3D transforms or SVG), SHALL load no external library or resource, and SHALL NOT hide the health state or the statistics. When the database or the service is down, the animation SHALL change its color to the error color.

#### Scenario: Healthy service
- **WHEN** the service and the database are healthy
- **THEN** the gyroscope rotates continuously with the normal accent color and glow

#### Scenario: Database down
- **WHEN** `GET /api/status` reports the database as `down`
- **THEN** the gyroscope uses the error color

#### Scenario: Unknown path stays JSON
- **WHEN** a client calls a path that is not a route and not a static file
- **THEN** the server responds with HTTP 404 and the JSON body `{"error":"not_found","error_description":"Not found"}`

```

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

## 1. Event counters

- [x] 1.1 Add the `event_counters` table to `src/schema.ts` and generate the Drizzle migration
- [x] 1.2 Increment `delivered`, `failed` or `dropped` in `deliver()`; log a failed write
- [x] 1.3 Integration tests for the three outcomes

## 2. Health and status API

- [x] 2.1 `/health` with a `SELECT 1` probe and a 2-second timeout; HTTP 503 on failure
- [x] 2.2 `src/status.ts`: statistics queries, 10-second cache, version
- [x] 2.3 `GET /api/status` route
- [x] 2.4 Integration tests: healthy, database down, cache, no sensitive fields

## 3. Frontend skeleton

- [x] 3.1 Create `web/` with React, Vite and TypeScript; lint and typecheck scripts
- [x] 3.2 `theme.css`: dark palette, accent and error colors, transition tokens, reduced-motion block
- [x] 3.3 Gyroscope component: nested rings with 3D rotation, glow, error color state
- [x] 3.4 Status page: health cards, statistics, subtle transitions, refresh every 30 seconds, no external resources
- [x] 3.3 Serve `web/dist` with `@fastify/static` at `/`; keep the JSON 404

## 4. Build and docs

- [x] 4.1 Dockerfile: build `web/` and copy the output into the runtime image
- [x] 4.2 CI: build and lint `web/`; Dependabot entry for `web/`
- [x] 4.3 Update `docs/deployment.md` and `README.md` (proxy paths, `/health` behavior, status page)

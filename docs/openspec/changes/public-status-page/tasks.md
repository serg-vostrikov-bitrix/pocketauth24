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

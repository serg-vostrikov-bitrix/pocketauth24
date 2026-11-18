# Brainstorm Summary

- Change: public-status-page
- Date: 2026-11-18
- Status: confirmed by the user

## Confirmed Technical Approach

- Layout confirmed by the user from a mockup: gyroscope at the top center, status pills below it, a grid of statistic cards, cyan accent, error color for the down state.
- `web/`: separate package (React 19, Vite, TypeScript). Root ESLint ignores `web/`; Prettier and `tsc` for `web/` run from root scripts and CI.
- `@fastify/static` serves the build from `webRoot` (an `AppDeps` field). Without a build, static serving is not registered and `/` returns the JSON 404.
- Headers: `index.html` with `no-cache`; `/assets/*` with an immutable cache; HTML with CSP `default-src 'self'`.
- `src/status.ts`: four queries in `Promise.all`, 10-second cache, `database: down` plus null statistics on failure.
- `/health`: `SELECT 1` raced against a 2-second timer; `pg` pool `connectionTimeoutMillis: 2000`.
- Counters: `recordOutcome(db, outcome, day)` called without `await` from `deliver()`; a failure logs `event_counter_failed`.
- Theme: CSS custom properties in `theme.css`; only `transform` and `opacity` animate; `prefers-reduced-motion` block.

## Key Trade-offs and Risks

- `/health` returns 503 when the database is down; document it.
- Second dependency tree in `web/`; add it to Dependabot.

## Testing Strategy

- Integration tests with real PostgreSQL: health ok and down (pool to a dead port, answer within 3 seconds); status fields, no sensitive strings, cache; three counter outcomes; static serving with a temporary `index.html` and CSP.
- CI container smoke test: `/` returns HTML, `/api/status` returns JSON.
- Gyroscope and visuals: manual check in a browser.

## Spec Patches

None.

---
comet_change: public-status-page
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-18-public-status-page
status: final
---

# Public status page: technical design

This document refines `docs/openspec/changes/public-status-page/design.md`. The OpenSpec delta specs are the canonical requirements. This document does not repeat them.

## 1. Repository layout

```
web/                      separate npm package
  package.json            react, react-dom, vite, @vitejs/plugin-react, typescript
  tsconfig.json
  vite.config.ts          build.outDir = dist, base = '/'
  index.html
  src/
    main.tsx
    StatusPage.tsx        fetch loop, layout
    Gyroscope.tsx         rings, healthy or error state
    StatCard.tsx
    StatusPill.tsx
    api.ts                type of the /api/status response, fetchStatus()
    theme.css             design tokens, reduced-motion block
src/
  status.ts               getStatus(), probeDatabase(), cache
  eventCounters.ts        recordOutcome()
  static.ts               registerWeb(app, webRoot)
```

- Root ESLint adds `web` to `ignores`. `web/` gets no ESLint of its own in this change: `tsc --noEmit` with `strict` covers type errors, and root Prettier covers format.
- Root `package.json` adds scripts `web:install` (`npm ci --prefix web`), `web:build` (`npm run build --prefix web`) and `web:typecheck`.
- The server and the UI share no code. `web/src/api.ts` declares the response type by hand. The integration test of `/api/status` checks the field names, so a drift breaks a test.

## 2. Server

### 2.1 Static files (`src/static.ts`)

- `buildApp` gets a new optional field `webRoot` in `AppDeps`. `server.ts` passes `new URL('../public', import.meta.url)`; the Dockerfile copies `web/dist` to `/app/public`.
- If `webRoot` is not set or `index.html` does not exist in it, `registerWeb` does nothing. Then `/` returns the JSON 404. Tests and `npm run dev` without a build keep working.
- Registration: `@fastify/static` with `root: webRoot`, `wildcard: false`, `index: false`, `decorateReply: true`. An explicit `GET /` route sends `index.html`. With `wildcard: false`, the plugin registers one route per file found at boot, so unknown paths still reach the JSON 404 handler.
- Headers through `setHeaders`:
  - `index.html`: `Cache-Control: no-cache`, `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`.
  - `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`.
- `style-src 'unsafe-inline'` is necessary because React sets inline `style` attributes for computed values. No inline script is used.

### 2.2 Database probe and status (`src/status.ts`)

```ts
type Outcome = 'delivered' | 'failed' | 'dropped';
type EventTotals = Record<Outcome, number>;
type Status = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'down';
  version: string;
  portals: number | null;
  applications: number | null;
  activeTokenPairs: number | null;
  events: { today: EventTotals; last7Days: EventTotals } | null;
};
```

- `probeDatabase(db, timeoutMs = 2000)`: `Promise.race` of `db.execute(sql\`select 1\`)` and a timer that rejects. It returns `true` or `false`, never throws. The timer is cleared in `finally`.
- `createDb` sets `connectionTimeoutMillis: 2000` on the `pg` pool. Without it, a request to an unreachable host waits for the OS TCP timeout, and requests pile up in the pool queue.
- `createStatusService({ db, version, log })` returns `get(): Promise<Status>`. It caches the promise itself as `{ at, promise }` for 10 seconds (`Date.now()`). Because the promise is cached from the start of the computation, concurrent calls share it without extra code, so 100 parallel requests produce one set of queries. The computation never rejects (see below), so a cached promise never holds an error.
- One computation: `Promise.all` of four queries:
  1. `select count(*) from portals`
  2. `select count(*) from applications`
  3. `select count(*) from token_pairs where refresh_expires_at > now()`
  4. `select day, outcome, sum(count) from event_counters where day >= :today - 6 group by day, outcome`
  The server sums query 4 into `today` and `last7Days` in TypeScript. `count(*)` returns a string in `pg`; convert with `Number()`.
- If any query fails, the result is `database: 'down'`, `status: 'degraded'`, all statistics `null`. The failure is logged once per computation as `status_query_failed`.
- `version` comes from `package.json`, read once at boot with `readFileSync` and `JSON.parse`.

### 2.3 Routes

- `GET /health`: `probeDatabase` → 200 `{"status":"ok"}` or 503 `{"status":"error","database":"down"}`. No cache.
- `GET /api/status`: `statusService.get()` → always HTTP 200. Header `Cache-Control: no-store`, so that a proxy does not keep a stale state.

### 2.4 Event counters (`src/eventCounters.ts`)

- Table `event_counters`: `day date not null`, `outcome text not null`, `count bigint not null default 0`, primary key `(day, outcome)`. A check constraint limits `outcome` to the three values.
- `recordOutcome(db, outcome, now: Date)`: `insert ... values (utcDay(now), outcome, 1) on conflict (day, outcome) do update set count = event_counters.count + 1`. `utcDay` is `now.toISOString().slice(0, 10)`.
- `deliver()` calls it at three points: the in-flight cap branch (`dropped`), `response.ok` (`delivered`), the non-OK and `catch` branches (`failed`). The call is `void recordOutcome(...).catch((err) => log.warn({ err }, 'event_counter_failed'))`. `MethodContext` gets `db` and a `now` function if it does not have them.
- No retention job: three rows per day.

## 3. Frontend

- `main.tsx` renders `StatusPage` into `#root`. No router in this change; `admin-panel` adds React Router.
- `StatusPage`: `fetchStatus()` on mount and every 30 seconds with `setInterval`. On a network error, keep the last data and show the service pill as `unreachable`. The interval stops on unmount.
- Layout (confirmed from the mockup): gyroscope at the top center; service, database and version line below; a responsive grid of cards (`repeat(auto-fit, minmax(160px, 1fr))`): portals, local applications, active token pairs, events today (with failed and dropped as a second line), events for 7 days.
- `null` statistics show as an em dash.
- Numbers: `Intl.NumberFormat` with the browser locale. A changed value gets a short fade (CSS `@keyframes` on a `key` change), 300 ms.
- Cards fade in on first render with a 40 ms stagger per card.

### 3.1 Gyroscope

- Four rings plus a core. Each ring: `border` with the accent color, `box-shadow` outer and inner glow, `border-radius: 50%`.
- Parent: `perspective: 800px`; rings: `transform-style: preserve-3d`, each with its own `@keyframes` on a different axis combination and a different period (about 4 s to 12 s), `animation-timing-function: linear`, `infinite`.
- Only `transform` animates. `will-change: transform` on the rings.
- State: prop `state: 'ok' | 'error'`. The component sets a class that switches `--gyro-color` to `--color-error`. The color change uses a 600 ms transition.
- Size: `clamp(140px, 30vw, 220px)`.
- `aria-hidden="true"`: it is decoration; the status pills carry the meaning.

### 3.2 Theme (`theme.css`)

- Tokens: `--bg` (deep navy), `--surface`, `--border`, `--text`, `--text-muted`, `--accent` (cyan), `--color-ok` (teal green), `--color-error` (soft red), `--radius`, `--dur-fast` (150 ms), `--dur-base` (300 ms).
- Font: the system font stack. No web fonts.
- `@media (prefers-reduced-motion: reduce)`: `animation: none` and `transition: none` on all elements. The gyroscope then shows static tilted rings.
- `admin-panel` imports the same file.

## 4. Build and delivery

- Dockerfile build stage: copy `web/package*.json`, `npm ci --prefix web`, copy `web/`, `npm run build --prefix web`. Runtime stage: `COPY --from=build /app/web/dist ./public`.
- CI `test` job: add `npm ci --prefix web`, `npm run web:typecheck`, `npm run web:build`.
- CI `container` job smoke test: `curl -fs http://localhost:3000/ | grep -q '<div id="root">'` and `curl -fs http://localhost:3000/api/status | grep -q '"database":"ok"'`.
- Dependabot: a second `npm` entry with `directory: /web`.
- `docs/deployment.md`: the proxy example allows `/`, `/assets/` and `/api/status`; describe `/health` 503. `README.md`: add the status page to the features table.

## 5. Edge cases

| Case | Behavior |
|---|---|
| Database unreachable at boot | Unchanged: migration fails and the process exits. The status page only covers a database that fails after boot. |
| Database fails after boot | `/health` 503 within about 2 s; `/api/status` 200 with `database: down`; gyroscope switches to the error color. |
| Server unreachable from the browser | The page keeps the last data and shows `unreachable`. |
| `event_counters` write fails | Delivery result unchanged; `event_counter_failed` in the log. |
| UTC midnight | `today` switches to the new day at the next cache refresh (at most 10 s late). |
| No build in `webRoot` | `/` returns the JSON 404; the API works. |
| Request for `/index.html` or `/favicon.ico` | Served if the file exists in the build, else JSON 404. |

## 6. Testing

All server tests use vitest with real PostgreSQL, as the existing suites do.

| Test | File | Checks |
|---|---|---|
| Health ok | `test/integration/health.test.ts` | 200 and `{"status":"ok"}` |
| Health down | same | App built with a `pg` pool to a closed port: 503 and the body, response in less than 3 s |
| Status fields | `test/integration/status.test.ts` | Seeded portal, application, two token pairs (one expired), counters: exact counts and all field names |
| No sensitive data | same | Response text contains no portal host, `client_id`, user ID or `https://` |
| Cache | same | Call `/api/status`, insert one more portal, call again: the second response shows the old count. Observable behavior, no query counter and no clock seam |
| Status with database down | same | Dead pool (shared fixture with "Health down"): 200, `database: down`, null statistics |
| Counters | `test/integration/event-delivery.test.ts` | One table-driven test: handler 200 → `delivered` +1; handler 500 → `failed` +1. `dropped` +1 goes into the existing in-flight cap test as one more assertion |
| Static | `test/integration/static.test.ts` | Temporary `webRoot` with `index.html` and one asset: `/` returns HTML with the CSP header; the asset has the immutable cache header; `/unknown` returns the JSON 404 |
| Container | CI `container` job | `/` HTML and `/api/status` JSON |

`truncateAll` in `test/helpers.ts` adds `event_counters`.

Visual behavior (gyroscope, transitions, reduced motion) gets a manual check in a browser before verify. It has no automated test.

## Implementation Divergence

Recorded in the verify phase on 2026-11-18. The delta specs are unchanged and satisfied.

1. **Dropped-event counter (section 2.4).** The final whole-branch review found that one upsert per dropped item on the same `(day, 'dropped')` row can exhaust the 10-connection pool under a large `rest.event.call` batch, and break `/oauth/token` for every portal. The in-flight cap check therefore moved from `deliver()` into `restEventCall`. `restEventCall` counts the dropped items of one batch and writes them with one upsert: `recordOutcome(db, 'dropped', now, n)`, which sets `count = count + n`. `deliver()` is no longer exported. The `event_dropped_overload` log line stays per item. `delivered` and `failed` stay one upsert per item, because the in-flight cap bounds them. Each dropped item still adds 1 to the daily `dropped` total.
2. **Unreachable API (sections 3 and 5).** When `/api/status` cannot be reached, the Database pill shows a neutral `unknown` state instead of the last value, and the gyroscope uses the error color. The service pill shows `unreachable`, as designed.

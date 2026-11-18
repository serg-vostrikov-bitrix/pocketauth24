---
change: public-status-page
design-doc: docs/superpowers/specs/2026-11-18-public-status-page-design.md
base-ref: 12f6c48f1950ad6f4ff99ce9ea40eb9186451bb5
---

# Public Status Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public status page at `/`, a public `GET /api/status` endpoint, a `/health` that fails when PostgreSQL fails, and daily counters of event delivery outcomes.

**Architecture:** The Fastify server gets three new modules: `src/eventCounters.ts` (daily upsert), `src/status.ts` (database probe, statistics, 10-second promise cache) and `src/static.ts` (serves the built UI with `@fastify/static`). A separate npm package in `web/` (React 19 + Vite + TypeScript, plain CSS) builds the page into `web/dist`. The Dockerfile copies `web/dist` to `/app/public`.

**Tech Stack:** Node 24, TypeScript strict, Fastify 5, `@fastify/static`, Drizzle ORM + PostgreSQL 17, vitest with real PostgreSQL, React 19, Vite.

## Global Constraints

- The OpenSpec delta specs in `docs/openspec/changes/public-status-page/specs/` are the canonical requirements. The Design Doc refines them. Do not add features, options or abstractions that the Design Doc does not name.
- English everywhere: code, comments, commit messages.
- Named exports only (except `web/vite.config.ts`, which Vite requires as a default export). No `enum`: use string literal unions.
- Conventional commits. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Server tests: vitest against real PostgreSQL (`TEST_DATABASE_URL`, default `postgres://b24auth:b24auth@localhost:5432/b24auth_test`). Start it with `docker compose up -d db` if it does not run.
- The UI loads no resource from outside the server: no CDN, no web fonts, no external URL.
- `/api/status` and the page expose aggregate counts only: no secrets, tokens, hashes, `client_id`, portal hosts, user IDs or handler URLs.
- `web/` gets no ESLint of its own. Root ESLint ignores `web`. `tsc --noEmit` (strict) checks types; root Prettier (`singleQuote`, `printWidth: 100`) checks format.
- Exact values: probe timeout 2000 ms; pool `connectionTimeoutMillis: 2000`; status cache 10 s; UI refresh 30 s; value fade 300 ms; card stagger 40 ms; gyroscope color transition 600 ms; gyroscope size `clamp(140px, 30vw, 220px)`; `perspective: 800px`.
- CSP for `index.html`: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`.

## Mapping to tasks.md

Note: `tasks.md` has two items numbered 3.3. This plan calls the second one (serve `web/dist`) "3.3 (serve)".

| Plan task | tasks.md items |
|---|---|
| Task 1: Event counters | 1.1, 1.2, 1.3 |
| Task 2: Health probe | 2.1, 2.4 (healthy and database-down cases of `/health`) |
| Task 3: Status service and `/api/status` | 2.2, 2.3, 2.4 |
| Task 4: Serve the built UI | 3.3 (serve) |
| Task 5: Frontend skeleton and status page | 3.1, 3.2, 3.4 |
| Task 6: Gyroscope | 3.3 |
| Task 7: Docker, CI, Dependabot | 4.1, 4.2 |
| Task 8: Documentation | 4.3 |

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/schema.ts` | Modify | `Outcome` type, `eventCounters` table |
| `drizzle/0001_event_counters.sql` | Create (generated) | Migration for `event_counters` |
| `src/eventCounters.ts` | Create | `utcDay()`, `recordOutcome()` |
| `src/methods/events.ts` | Modify | Count outcomes in `deliver()` |
| `src/db.ts` | Modify | `connectionTimeoutMillis: 2000` |
| `src/config.ts` | Modify | `STATUS_CACHE_MS` |
| `src/status.ts` | Create | `VERSION`, `probeDatabase()`, `createStatusService()`, `Status` type |
| `src/static.ts` | Create | `registerWeb()` |
| `src/app.ts` | Modify | `/health`, `/api/status`, `webRoot` |
| `src/server.ts` | Modify | Pass `webRoot` |
| `test/helpers.ts` | Modify | `startApp` options, `DEAD_DATABASE_URL`, `startHandler` status, `truncateAll` |
| `test/integration/event-delivery.test.ts` | Modify | Counter tests |
| `test/integration/health.test.ts` | Modify | Database-down test |
| `test/integration/status.test.ts` | Create | `/api/status` tests |
| `test/integration/static.test.ts` | Create | Static file tests |
| `web/*` | Create | React app (see Task 5 and Task 6) |
| `package.json`, `eslint.config.js` | Modify | `web:*` scripts, `@fastify/static`, ignore `web` |
| `Dockerfile`, `.dockerignore` | Modify | Build `web/`, copy `public` |
| `.github/workflows/ci.yml`, `.github/dependabot.yml` | Modify | Build and check `web/`, smoke test, Dependabot entry |
| `docs/deployment.md`, `README.md` | Modify | Proxy paths, `/health` 503, status page |

---

### Task 1: Event counters

- [x] Task 1 complete: Event counters

Checks off: **tasks.md 1.1, 1.2, 1.3**

**Files:**
- Modify: `src/schema.ts`
- Create: `drizzle/0001_event_counters.sql` (generated by drizzle-kit, plus `drizzle/meta/*` updates)
- Create: `src/eventCounters.ts`
- Modify: `src/methods/events.ts:88-129` (`deliver`)
- Modify: `test/helpers.ts` (`truncateAll`, `startHandler`)
- Test: `test/integration/event-delivery.test.ts`

**Interfaces:**
- Produces: `export type Outcome = 'delivered' | 'failed' | 'dropped'` and `export const eventCounters` in `src/schema.ts` (columns `day: string` `YYYY-MM-DD`, `outcome: Outcome`, `count: number`).
- Produces: `export function utcDay(now: Date): string` and `export async function recordOutcome(db: Db, outcome: Outcome, now: Date): Promise<void>` in `src/eventCounters.ts`.
- Produces: `startHandler(options: { hold?: boolean; status?: number })` in `test/helpers.ts`.

- [x] **Step 1: Extend the test helpers**

In `test/helpers.ts`, change `truncateAll`:

```ts
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE portals, applications, token_pairs, event_counters RESTART IDENTITY CASCADE`,
  );
}
```

Change the `startHandler` signature and the non-hold branch:

```ts
export async function startHandler(
  options: { hold?: boolean; status?: number } = {},
): Promise<HandlerServer> {
```

```ts
      if (options.hold) held.push(res);
      else {
        res.statusCode = options.status ?? 200;
        res.end('ok');
      }
```

- [x] **Step 2: Write the failing counter tests**

In `test/integration/event-delivery.test.ts`, add the import and a helper below `beforeEach`:

```ts
import { eventCounters } from '../../src/schema.js';
import { utcDay } from '../../src/eventCounters.js';

async function counterRows(): Promise<{ day: string; outcome: string; count: number }[]> {
  return t.db
    .select({ day: eventCounters.day, outcome: eventCounters.outcome, count: eventCounters.count })
    .from(eventCounters);
}
```

Add this test as the **first** test inside `describe('event-delivery', ...)`. It runs first so that no late counter write from an earlier test lands in its rows:

```ts
  it.each([
    { status: 200, outcome: 'delivered' },
    { status: 500, outcome: 'failed' },
  ] as const)('Handler responds $status: $outcome counter +1', async ({ status, outcome }) => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ status });
    try {
      await rpc(t.app, portal, 'rest.event.call', { QUERY: [eventItem(handler.url)] });
      await vi.waitFor(async () => {
        expect(await counterRows()).toEqual([{ day: utcDay(new Date()), outcome, count: 1 }]);
      });
    } finally {
      await handler.close();
    }
  });
```

In the existing `it('Overload', ...)`, after the `dropped` log assertions (line 207), add:

```ts
      await vi.waitFor(async () => {
        expect((await counterRows()).find((r) => r.outcome === 'dropped')?.count).toBe(1);
      });
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npm test -- test/integration/event-delivery.test.ts`
Expected: FAIL. The imports of `eventCounters` and `utcDay` do not resolve.

- [x] **Step 4: Add the table to the schema**

In `src/schema.ts`, add `check`, `date` and `primaryKey` to the `drizzle-orm/pg-core` import, add `import { sql } from 'drizzle-orm';`, and add at the end of the tables:

```ts
export type Outcome = 'delivered' | 'failed' | 'dropped';

export const eventCounters = pgTable(
  'event_counters',
  {
    day: date('day').notNull(),
    outcome: text('outcome').$type<Outcome>().notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.outcome] }),
    check(
      'event_counters_outcome_check',
      sql`${table.outcome} in ('delivered', 'failed', 'dropped')`,
    ),
  ],
);
```

- [x] **Step 5: Generate the migration**

Run: `npm run db:generate -- --name event_counters`
Expected: a new file `drizzle/0001_event_counters.sql` with `CREATE TABLE "event_counters"`, the primary key on `("day","outcome")` and the check constraint. Read the file and confirm these three parts.

- [x] **Step 6: Write `src/eventCounters.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { eventCounters, type Outcome } from './schema.js';

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function recordOutcome(db: Db, outcome: Outcome, now: Date): Promise<void> {
  await db
    .insert(eventCounters)
    .values({ day: utcDay(now), outcome, count: 1 })
    .onConflictDoUpdate({
      target: [eventCounters.day, eventCounters.outcome],
      set: { count: sql`${eventCounters.count} + 1` },
    });
}
```

- [x] **Step 7: Count outcomes in `deliver()`**

In `src/methods/events.ts`, add imports:

```ts
import { recordOutcome } from '../eventCounters.js';
import { applications, type Outcome } from '../schema.js';
```

(Replace the existing `import { applications } from '../schema.js';`.)

Add above `deliver`:

```ts
// A counter write never blocks or changes the delivery.
function countOutcome(ctx: MethodContext, outcome: Outcome): void {
  void recordOutcome(ctx.db, outcome, new Date()).catch((err: unknown) => {
    ctx.log.warn({ err }, 'event_counter_failed');
  });
}
```

`MethodContext` already has `db`. The call passes `new Date()` directly, so `MethodContext` needs no `now` function.

Change three places in `deliver`:

```ts
  if (ctx.delivery.inFlight >= EVENT_IN_FLIGHT_CAP) {
    // ponytail: in-memory cap, persistent queue in stage 3
    ctx.log.warn(fields, 'event_dropped_overload');
    countOutcome(ctx, 'dropped');
    return;
  }
```

```ts
    await response.body?.cancel();
    if (response.ok) {
      countOutcome(ctx, 'delivered');
    } else {
      ctx.log.warn({ ...fields, status: response.status }, 'event_delivery_failed');
      countOutcome(ctx, 'failed');
    }
  } catch (error) {
    ctx.log.warn(
      { ...fields, error: errorText(error).replaceAll(item.query.QUERY_URL, fields.url) },
      'event_delivery_failed',
    );
    countOutcome(ctx, 'failed');
  } finally {
```

- [x] **Step 8: Run the tests to verify they pass**

Run: `npm test -- test/integration/event-delivery.test.ts`
Expected: PASS (all tests, including the two new cases and the extended `Overload` test).

- [x] **Step 9: Run the full checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS.

- [x] **Step 10: Commit**

```bash
git add src/schema.ts src/eventCounters.ts src/methods/events.ts drizzle test/helpers.ts test/integration/event-delivery.test.ts
git commit -m "feat(events): count delivery outcomes per UTC day"
```

---

### Task 2: Health probe

- [ ] Task 2 complete: Health probe

Checks off: **tasks.md 2.1** and the `/health` part of **2.4**

**Files:**
- Modify: `src/db.ts:8`
- Create: `src/status.ts` (only `probeDatabase` in this task)
- Modify: `src/app.ts:12,38`
- Modify: `test/helpers.ts` (`DEAD_DATABASE_URL`, `startApp` options)
- Test: `test/integration/health.test.ts`

**Interfaces:**
- Produces: `export async function probeDatabase(db: Db, timeoutMs = 2000): Promise<boolean>` in `src/status.ts`. It never throws.
- Produces: `export const DEAD_DATABASE_URL: string` and `startApp(options: { databaseUrl?: string; webRoot?: string } = {})` in `test/helpers.ts`.
- Produces: `AppDeps.webRoot?: string` in `src/app.ts` (used in Task 4).

- [ ] **Step 1: Extend `startApp`**

In `test/helpers.ts`, add below `TEST_DATABASE_URL`:

```ts
// Nothing listens on port 1, so every connection fails at once.
export const DEAD_DATABASE_URL = 'postgres://b24auth:b24auth@127.0.0.1:1/b24auth_test';
```

Change `startApp`:

```ts
export async function startApp(
  options: { databaseUrl?: string; webRoot?: string } = {},
): Promise<TestApp> {
  const { db, pool } = createDb(options.databaseUrl ?? TEST_DATABASE_URL);
```

and the `buildApp` call:

```ts
  const app = await buildApp({ config: TEST_CONFIG, db, logStream, webRoot: options.webRoot });
```

In `src/app.ts`, change `AppDeps` so that this compiles:

```ts
export type AppDeps = { config: Config; db: Db; logStream?: Writable; webRoot?: string };
```

- [ ] **Step 2: Write the failing test**

Replace `test/integration/health.test.ts` with:

```ts
import { expect, it } from 'vitest';
import { DEAD_DATABASE_URL, startApp } from '../helpers.js';

it('GET /health returns ok', async () => {
  const t = await startApp();
  const res = await t.app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  await t.close();
});

it('GET /health returns 503 when the database is down', async () => {
  const t = await startApp({ databaseUrl: DEAD_DATABASE_URL });
  try {
    const started = Date.now();
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', database: 'down' });
  } finally {
    await t.close();
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- test/integration/health.test.ts`
Expected: FAIL in the second test: status 200, expected 503.

- [ ] **Step 4: Set the pool connection timeout**

In `src/db.ts`:

```ts
  // Without it, a request to an unreachable host waits for the OS TCP timeout.
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
```

- [ ] **Step 5: Write `probeDatabase` in `src/status.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Db } from './db.js';

export async function probeDatabase(db: Db, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('database_probe_timeout')), timeoutMs);
  });
  try {
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 6: Use the probe in `/health`**

In `src/app.ts`, add `import { probeDatabase } from './status.js';` and replace line 38:

```ts
  app.get('/health', async (_request, reply) =>
    (await probeDatabase(deps.db))
      ? { status: 'ok' }
      : reply.status(503).send({ status: 'error', database: 'down' }),
  );
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- test/integration/health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Run the full checks**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/db.ts src/status.ts src/app.ts test/helpers.ts test/integration/health.test.ts
git commit -m "feat(health): return 503 when the database does not answer within 2 seconds"
```

---

### Task 3: Status service and `GET /api/status`

- [ ] Task 3 complete: Status service and `GET /api/status`

Checks off: **tasks.md 2.2, 2.3, 2.4**

**Files:**
- Modify: `src/config.ts`
- Modify: `src/status.ts`
- Modify: `src/app.ts`
- Test: `test/integration/status.test.ts`

**Interfaces:**
- Consumes: `probeDatabase` (Task 2), `utcDay`, `eventCounters`, `Outcome` (Task 1), `startApp({ databaseUrl })`, `DEAD_DATABASE_URL` (Task 2).
- Produces in `src/status.ts`:
  - `export type EventTotals = Record<Outcome, number>`
  - `export type Status = { status: 'ok' | 'degraded'; database: 'ok' | 'down'; version: string; portals: number | null; applications: number | null; activeTokenPairs: number | null; events: { today: EventTotals; last7Days: EventTotals } | null }`
  - `export const VERSION: string`
  - `export function createStatusService(deps: { db: Db; version: string; log: FastifyBaseLogger }): { get: () => Promise<Status> }`
- Produces: the JSON shape of `/api/status`. Task 5 copies this type by hand into `web/src/api.ts`.

- [ ] **Step 1: Write the failing tests**

Create `test/integration/status.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { utcDay } from '../../src/eventCounters.js';
import { eventCounters, portals, tokenPairs } from '../../src/schema.js';
import {
  addApp,
  authorize,
  DEAD_DATABASE_URL,
  registerPortal,
  startApp,
  truncateAll,
  type Credentials,
  type TestApp,
} from '../helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VERSION = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

// A fresh app per test: each app has its own 10-second cache.
let t: TestApp;
beforeEach(async () => {
  t = await startApp();
  await truncateAll(t.db);
});
afterEach(async () => {
  await t.close();
});

async function seed(): Promise<{ portal: Credentials; appClientId: string }> {
  const portal = await registerPortal(t.app);
  const app = await addApp(t.app, portal);
  await authorize(t.app, portal, app.client_id);
  await authorize(t.app, portal, app.client_id);
  const [first] = await t.db.select({ id: tokenPairs.id }).from(tokenPairs).limit(1);
  await t.db
    .update(tokenPairs)
    .set({ refreshExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(tokenPairs.id, first.id));
  const now = Date.now();
  const day = (daysAgo: number): string => utcDay(new Date(now - daysAgo * DAY_MS));
  await t.db.insert(eventCounters).values([
    { day: day(0), outcome: 'delivered', count: 3 },
    { day: day(0), outcome: 'failed', count: 1 },
    { day: day(3), outcome: 'delivered', count: 2 },
    { day: day(3), outcome: 'dropped', count: 1 },
    { day: day(8), outcome: 'delivered', count: 100 },
  ]);
  return { portal, appClientId: app.client_id };
}

it('GET /api/status returns all fields for a healthy database', async () => {
  await seed();
  const res = await t.app.inject({ method: 'GET', url: '/api/status' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.json()).toEqual({
    status: 'ok',
    database: 'ok',
    version: VERSION,
    portals: 1,
    applications: 1,
    activeTokenPairs: 1,
    events: {
      today: { delivered: 3, failed: 1, dropped: 0 },
      last7Days: { delivered: 5, failed: 1, dropped: 1 },
    },
  });
});

it('GET /api/status exposes no sensitive values', async () => {
  const { portal, appClientId } = await seed();
  const hashes = await t.db.select({ access: tokenPairs.accessHash }).from(tokenPairs);
  const text = (await t.app.inject({ method: 'GET', url: '/api/status' })).body;
  for (const value of ['portal.test', portal.client_id, appClientId, 'https://']) {
    expect(text).not.toContain(value);
  }
  for (const { access } of hashes) expect(text).not.toContain(access);
  expect(text).not.toMatch(/user/i);
});

it('GET /api/status serves cached statistics', async () => {
  await registerPortal(t.app);
  const first = await t.app.inject({ method: 'GET', url: '/api/status' });
  expect(first.json()).toMatchObject({ portals: 1 });

  await t.db
    .insert(portals)
    .values({ origin: 'https://other.test', clientId: 'cache-test', secretHash: 'x' });
  const second = await t.app.inject({ method: 'GET', url: '/api/status' });
  expect(second.json()).toMatchObject({ portals: 1 });
});

it('GET /api/status reports a failed database with null statistics', async () => {
  const dead = await startApp({ databaseUrl: DEAD_DATABASE_URL });
  try {
    const res = await dead.app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'degraded',
      database: 'down',
      version: VERSION,
      portals: null,
      applications: null,
      activeTokenPairs: null,
      events: null,
    });
    expect(dead.logs.filter((l) => l.msg === 'status_query_failed')).toHaveLength(1);
  } finally {
    await dead.close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/integration/status.test.ts`
Expected: FAIL in all four tests: `/api/status` returns the JSON 404.

- [ ] **Step 3: Add the cache constant**

In `src/config.ts`, after `CLEANUP_INTERVAL_MS`:

```ts
export const STATUS_CACHE_MS = 10_000;
```

- [ ] **Step 4: Write the status service**

Replace the imports at the top of `src/status.ts` and add the code below `probeDatabase`:

```ts
import { readFileSync } from 'node:fs';
import { gte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { STATUS_CACHE_MS } from './config.js';
import type { Db } from './db.js';
import { utcDay } from './eventCounters.js';
import { applications, eventCounters, portals, tokenPairs, type Outcome } from './schema.js';

export type EventTotals = Record<Outcome, number>;
export type Status = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'down';
  version: string;
  portals: number | null;
  applications: number | null;
  activeTokenPairs: number | null;
  events: { today: EventTotals; last7Days: EventTotals } | null;
};

// Resolves to the repository root from both src/ and dist/.
export const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const DAY_MS = 24 * 60 * 60 * 1000;
```

```ts
function emptyTotals(): EventTotals {
  return { delivered: 0, failed: 0, dropped: 0 };
}

// Never rejects: a failed query gives database 'down' and null statistics.
async function computeStatus(db: Db, version: string, log: FastifyBaseLogger): Promise<Status> {
  const now = new Date();
  const today = utcDay(now);
  const firstDay = utcDay(new Date(now.getTime() - 6 * DAY_MS));
  try {
    const [portalCount, applicationCount, activeTokenPairs, rows] = await Promise.all([
      db.$count(portals),
      db.$count(applications),
      db.$count(tokenPairs, sql`${tokenPairs.refreshExpiresAt} > now()`),
      db
        .select({
          day: eventCounters.day,
          outcome: eventCounters.outcome,
          count: sql<string>`sum(${eventCounters.count})`,
        })
        .from(eventCounters)
        .where(gte(eventCounters.day, firstDay))
        .groupBy(eventCounters.day, eventCounters.outcome),
    ]);
    const events = { today: emptyTotals(), last7Days: emptyTotals() };
    for (const row of rows) {
      const count = Number(row.count);
      events.last7Days[row.outcome] += count;
      if (row.day === today) events.today[row.outcome] += count;
    }
    return {
      status: 'ok',
      database: 'ok',
      version,
      portals: portalCount,
      applications: applicationCount,
      activeTokenPairs,
      events,
    };
  } catch (err) {
    log.error({ err }, 'status_query_failed');
    return {
      status: 'degraded',
      database: 'down',
      version,
      portals: null,
      applications: null,
      activeTokenPairs: null,
      events: null,
    };
  }
}

// Caches the promise from the start of the computation, so concurrent calls share one set of
// queries.
export function createStatusService(deps: {
  db: Db;
  version: string;
  log: FastifyBaseLogger;
}): { get: () => Promise<Status> } {
  let cached: { at: number; promise: Promise<Status> } | null = null;
  return {
    get: () => {
      const now = Date.now();
      if (!cached || now - cached.at >= STATUS_CACHE_MS) {
        cached = { at: now, promise: computeStatus(deps.db, deps.version, deps.log) };
      }
      return cached.promise;
    },
  };
}
```

- [ ] **Step 5: Add the route**

In `src/app.ts`, change the status import:

```ts
import { createStatusService, probeDatabase, VERSION } from './status.js';
```

Add after the `/health` route:

```ts
  const statusService = createStatusService({ db: deps.db, version: VERSION, log: app.log });
  app.get('/api/status', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return statusService.get();
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/integration/status.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full checks**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts src/status.ts src/app.ts test/integration/status.test.ts
git commit -m "feat(status): add GET /api/status with aggregate statistics and a 10-second cache"
```

---

### Task 4: Serve the built UI

- [ ] Task 4 complete: Serve the built UI

Checks off: **tasks.md 3.3 (serve)**

**Files:**
- Modify: `package.json` (dependency `@fastify/static`)
- Create: `src/static.ts`
- Modify: `src/app.ts` (`buildApp`)
- Modify: `src/server.ts:11`
- Test: `test/integration/static.test.ts`

**Interfaces:**
- Consumes: `AppDeps.webRoot?: string` and `startApp({ webRoot })` (Task 2).
- Produces: `export async function registerWeb(app: FastifyInstance, webRoot: string): Promise<void>` in `src/static.ts`.
- Produces: the server serves the content of `/app/public` (`web/dist` in the image) at `/` and `/assets/*`.

- [ ] **Step 1: Write the failing tests**

Create `test/integration/static.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startApp, type TestApp } from '../helpers.js';

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

let webRoot: string;
let emptyRoot: string;
let t: TestApp;
beforeAll(async () => {
  webRoot = await mkdtemp(join(tmpdir(), 'b24auth-web-'));
  emptyRoot = await mkdtemp(join(tmpdir(), 'b24auth-web-empty-'));
  await writeFile(join(webRoot, 'index.html'), '<!doctype html><div id="root"></div>');
  await mkdir(join(webRoot, 'assets'));
  await writeFile(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1);');
  t = await startApp({ webRoot });
});
afterAll(async () => {
  await t.close();
  await rm(webRoot, { recursive: true, force: true });
  await rm(emptyRoot, { recursive: true, force: true });
});

it('GET / returns the status page with security headers', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/^text\/html/);
  expect(res.body).toContain('<div id="root">');
  expect(res.headers['cache-control']).toBe('no-cache');
  expect(res.headers['content-security-policy']).toBe(CSP);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
});

it('GET /assets/* returns the file with an immutable cache header', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
});

it('Unknown path returns the JSON 404', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/unknown' });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: 'not_found', error_description: 'Not found' });
});

// Guards the no-build branch; it also passes before registerWeb exists.
it('Without index.html in webRoot, / returns the JSON 404', async () => {
  const bare = await startApp({ webRoot: emptyRoot });
  try {
    const res = await bare.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', error_description: 'Not found' });
  } finally {
    await bare.close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/integration/static.test.ts`
Expected: FAIL in the first two tests (404). The last two tests pass.

- [ ] **Step 3: Install `@fastify/static`**

Run: `npm install @fastify/static`
Expected: `package.json` `dependencies` gets `@fastify/static` (the latest major that supports Fastify 5).

- [ ] **Step 4: Write `src/static.ts`**

```ts
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

// Without a build (tests, `npm run dev`), `/` stays the JSON 404.
export async function registerWeb(app: FastifyInstance, webRoot: string): Promise<void> {
  if (!existsSync(join(webRoot, 'index.html'))) return;
  await app.register(fastifyStatic, {
    root: webRoot,
    // One route per file found at boot, so unknown paths still reach the JSON 404 handler.
    wildcard: false,
    index: false,
    decorateReply: true,
    cacheControl: false,
    setHeaders: (res, path) => {
      if (path.endsWith(`${sep}index.html`)) {
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('content-security-policy', CSP);
        res.setHeader('x-content-type-options', 'nosniff');
      } else if (path.includes(`${sep}assets${sep}`)) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      }
    },
  });
  app.get('/', async (_request, reply) => reply.sendFile('index.html'));
}
```

`cacheControl: false` turns off the default `Cache-Control` of the plugin, so `setHeaders` sets the only value.

- [ ] **Step 5: Register it in `buildApp`**

In `src/app.ts`, add `import { registerWeb } from './static.js';` and add before `return app;`:

```ts
  if (deps.webRoot) await registerWeb(app, deps.webRoot);
```

- [ ] **Step 6: Pass `webRoot` from the server**

In `src/server.ts`, add `import { fileURLToPath } from 'node:url';` and change line 11:

```ts
// dist/server.js → /app/public in the image; the Dockerfile copies web/dist there.
const webRoot = fileURLToPath(new URL('../public', import.meta.url));
const app = await buildApp({ config, db, webRoot });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- test/integration/static.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Run the full checks**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all PASS. The routing tests still pass, so the JSON 404 is unchanged.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/static.ts src/app.ts src/server.ts test/integration/static.test.ts
git commit -m "feat(web): serve the built UI with @fastify/static and keep the JSON 404"
```

---

### Task 5: Frontend skeleton and status page

- [ ] Task 5 complete: Frontend skeleton and status page

Checks off: **tasks.md 3.1, 3.2, 3.4**

The Design Doc gives the frontend no automated tests. The verification for this task is: `tsc --noEmit` (strict), a Vite build, a check that the build references no external URL, and a manual check in a browser.

`tasks.md` 3.1 says "lint and typecheck scripts". The Design Doc decides: no ESLint in `web/`; `web:typecheck` plus root Prettier. Follow the Design Doc.

**Files:**
- Create: `web/package.json`, `web/package-lock.json` (generated), `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/api.ts`, `web/src/StatusPage.tsx`, `web/src/StatCard.tsx`, `web/src/StatusPill.tsx`, `web/src/theme.css`, `web/src/status.css`
- Modify: `package.json` (scripts), `eslint.config.js` (ignore `web`)

**Interfaces:**
- Consumes: the `/api/status` JSON shape from Task 3.
- Produces: `StatusPage` with a `<header className="hero">` element. Task 6 inserts the gyroscope as the first child of this element.
- Produces: root scripts `web:install`, `web:build`, `web:typecheck` (used by Task 7).
- Produces: CSS tokens `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--accent`, `--color-ok`, `--color-error`, `--radius`, `--dur-fast`, `--dur-base` (used by Task 6 and later by `admin-panel`).

- [ ] **Step 1: Create the package**

Create `web/package.json`:

```json
{
  "name": "b24auth-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

Run:

```bash
npm install --prefix web react@19 react-dom@19
npm install --prefix web -D vite @vitejs/plugin-react typescript @types/react@19 @types/react-dom@19
```

Expected: `web/package-lock.json` exists; `web/node_modules` exists and git ignores it (root `.gitignore` has `node_modules` and `dist`).

- [ ] **Step 2: Add the configuration files**

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist' },
  // `npm run dev --prefix web` reads the API of a local `npm run dev` server.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>b24auth-server status</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Add the root scripts and the ESLint ignore**

In root `package.json` `scripts`, add:

```json
    "web:install": "npm ci --prefix web",
    "web:build": "npm run build --prefix web",
    "web:typecheck": "npm run typecheck --prefix web",
```

In `eslint.config.js`, add `'web',` to the `ignores` array (after `'node_modules',`).

- [ ] **Step 4: Write `web/src/theme.css`**

```css
:root {
  --bg: #0b1220;
  --surface: #111a2e;
  --border: #1f2c47;
  --text: #e6edf7;
  --text-muted: #8a9bb8;
  --accent: #38d6f5;
  --color-ok: #3ddc97;
  --color-error: #ff6b6b;
  --radius: 12px;
  --dur-fast: 150ms;
  --dur-base: 300ms;
  color-scheme: dark;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'Helvetica Neue',
    Arial,
    sans-serif;
  -webkit-font-smoothing: antialiased;
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 5: Write `web/src/api.ts`**

```ts
// Declared by hand; test/integration/status.test.ts checks the server side of these names.
export type Outcome = 'delivered' | 'failed' | 'dropped';
export type EventTotals = Record<Outcome, number>;
export type Status = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'down';
  version: string;
  portals: number | null;
  applications: number | null;
  activeTokenPairs: number | null;
  events: { today: EventTotals; last7Days: EventTotals } | null;
};

export async function fetchStatus(): Promise<Status> {
  const res = await fetch('/api/status', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Status;
}
```

- [ ] **Step 6: Write `web/src/StatusPill.tsx` and `web/src/StatCard.tsx`**

`web/src/StatusPill.tsx`:

```tsx
type Tone = 'ok' | 'error' | 'muted';

function toneOf(value: string): Tone {
  if (value === 'ok') return 'ok';
  if (value === 'loading') return 'muted';
  return 'error';
}

export function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className={`pill pill--${toneOf(value)}`}>
      <span className="pill-dot" />
      {label}: {value}
    </span>
  );
}
```

`web/src/StatCard.tsx`:

```tsx
import type { CSSProperties } from 'react';

const numberFormat = new Intl.NumberFormat();

export function formatCount(value: number | null): string {
  return value === null ? '—' : numberFormat.format(value);
}

export function StatCard(props: {
  index: number;
  label: string;
  value: number | null;
  detail?: string;
}) {
  const text = formatCount(props.value);
  return (
    <div className="card" style={{ '--i': props.index } as CSSProperties}>
      <div className="card-label">{props.label}</div>
      {/* A new key remounts the value, so a changed value fades in. */}
      <div key={text} className="card-value">
        {text}
      </div>
      {props.detail && <div className="card-detail">{props.detail}</div>}
    </div>
  );
}
```

- [ ] **Step 7: Write `web/src/StatusPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { fetchStatus, type EventTotals, type Status } from './api';
import { formatCount, StatCard } from './StatCard';
import { StatusPill } from './StatusPill';

const REFRESH_MS = 30_000;

function failedAndDropped(totals: EventTotals): string {
  return `${formatCount(totals.failed)} failed · ${formatCount(totals.dropped)} dropped`;
}

export function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let active = true;
    const load = (): void => {
      fetchStatus().then(
        (next) => {
          if (!active) return;
          setStatus(next);
          setReachable(true);
        },
        // Keep the last data; only the service pill changes.
        () => {
          if (active) setReachable(false);
        },
      );
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const service = reachable ? (status?.status ?? 'loading') : 'unreachable';
  const database = status?.database ?? 'loading';
  const events = status?.events ?? null;

  return (
    <main className="page">
      <header className="hero">
        <h1 className="title">b24auth-server</h1>
        <div className="pills">
          <StatusPill label="Service" value={service} />
          <StatusPill label="Database" value={database} />
          {status && <span className="version">v{status.version}</span>}
        </div>
      </header>
      <section className="cards">
        <StatCard index={0} label="Portals" value={status?.portals ?? null} />
        <StatCard index={1} label="Local applications" value={status?.applications ?? null} />
        <StatCard index={2} label="Active token pairs" value={status?.activeTokenPairs ?? null} />
        <StatCard
          index={3}
          label="Events delivered today"
          value={events?.today.delivered ?? null}
          detail={events ? failedAndDropped(events.today) : undefined}
        />
        <StatCard
          index={4}
          label="Events delivered, 7 days"
          value={events?.last7Days.delivered ?? null}
          detail={events ? failedAndDropped(events.last7Days) : undefined}
        />
      </section>
    </main>
  );
}
```

- [ ] **Step 8: Write `web/src/status.css` and `web/src/main.tsx`**

`web/src/status.css` (page styles; `theme.css` keeps only shared tokens and base rules):

```css
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 48px 24px;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-bottom: 40px;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.pills {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  font-size: 0.875rem;
  transition:
    border-color var(--dur-base) ease,
    color var(--dur-base) ease;
}

.pill-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.pill--ok {
  color: var(--color-ok);
}

.pill--error {
  color: var(--color-error);
  border-color: var(--color-error);
}

.pill--muted {
  color: var(--text-muted);
}

.version {
  color: var(--text-muted);
  font-size: 0.875rem;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
}

.card {
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  animation: fade-in var(--dur-base) ease both;
  animation-delay: calc(var(--i, 0) * 40ms);
}

.card-label {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.card-value {
  margin-top: 8px;
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
  animation: fade-in var(--dur-base) ease;
}

.card-detail {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 0.8125rem;
}
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StatusPage } from './StatusPage';
import './theme.css';
import './status.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <StatusPage />
  </StrictMode>,
);
```

- [ ] **Step 9: Typecheck, format and build**

Run: `npx prettier --write web && npm run web:typecheck && npm run web:build`
Expected: no type errors; `web/dist/index.html` and `web/dist/assets/*.js`, `*.css` exist.

- [ ] **Step 10: Check that the build loads nothing from outside**

Run: `grep -rEo "(src|href)=\"https?://[^\"]*\"|url\(https?://[^)]*\)|@import" web/dist`
Expected: no output.

- [ ] **Step 11: Run the root checks**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all PASS. ESLint does not read `web/`; Prettier passes on `web/` sources.

- [ ] **Step 12: Manual check in a browser**

1. Start the database: `docker compose up -d db`.
2. In one terminal: `BASE_URL=http://localhost:3000 DATABASE_URL=postgres://b24auth:b24auth@localhost:5432/b24auth PORTAL_ALLOWLIST=portal.test npm run dev`.
3. In a second terminal: `npm run dev --prefix web`. Open the URL that Vite prints.
4. Make sure that: the background is dark; the pills show `Service: ok` and `Database: ok`; five cards show numbers; the cards fade in one after another.
5. Stop the server (first terminal). Wait 30 seconds. Make sure that the numbers stay and the service pill shows `unreachable`.

- [ ] **Step 13: Commit**

```bash
git add web package.json eslint.config.js
git commit -m "feat(web): add the React status page with theme tokens and a 30-second refresh"
```

---

### Task 6: Gyroscope

- [ ] Task 6 complete: Gyroscope

Checks off: **tasks.md 3.3**

**Files:**
- Create: `web/src/Gyroscope.tsx`
- Modify: `web/src/status.css` (append gyroscope styles)
- Modify: `web/src/StatusPage.tsx` (render the gyroscope)

**Interfaces:**
- Consumes: `StatusPage` `<header className="hero">`, CSS tokens `--accent`, `--color-error` (Task 5).
- Produces: `export function Gyroscope({ state }: { state: 'ok' | 'error' })`.

- [ ] **Step 1: Write `web/src/Gyroscope.tsx`**

```tsx
// Decoration only; the status pills carry the meaning.
export function Gyroscope({ state }: { state: 'ok' | 'error' }) {
  return (
    <div className={state === 'error' ? 'gyro gyro--error' : 'gyro'} aria-hidden="true">
      <div className="gyro-ring gyro-ring--1" />
      <div className="gyro-ring gyro-ring--2" />
      <div className="gyro-ring gyro-ring--3" />
      <div className="gyro-ring gyro-ring--4" />
      <div className="gyro-core" />
    </div>
  );
}
```

- [ ] **Step 2: Append the gyroscope styles to `web/src/status.css`**

Each ring has a static tilted `transform` equal to the first keyframe. With reduced motion, `animation: none` leaves the rings static and tilted.

```css
.gyro {
  --gyro-color: var(--accent);
  position: relative;
  width: clamp(140px, 30vw, 220px);
  aspect-ratio: 1;
  perspective: 800px;
  transform-style: preserve-3d;
}

.gyro--error {
  --gyro-color: var(--color-error);
}

.gyro-ring {
  position: absolute;
  border: 2px solid var(--gyro-color);
  border-radius: 50%;
  box-shadow:
    0 0 12px var(--gyro-color),
    inset 0 0 12px var(--gyro-color);
  opacity: 0.85;
  transform-style: preserve-3d;
  will-change: transform;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  transition:
    border-color 600ms ease,
    box-shadow 600ms ease;
}

.gyro-ring--1 {
  inset: 0;
  transform: rotateX(70deg) rotateZ(0deg);
  animation-name: gyro-1;
  animation-duration: 12s;
}

.gyro-ring--2 {
  inset: 9%;
  transform: rotateY(60deg) rotateZ(0deg);
  animation-name: gyro-2;
  animation-duration: 9s;
}

.gyro-ring--3 {
  inset: 18%;
  transform: rotateX(0deg) rotateY(0deg);
  animation-name: gyro-3;
  animation-duration: 6s;
}

.gyro-ring--4 {
  inset: 27%;
  transform: rotateZ(0deg) rotateX(45deg) rotateY(0deg);
  animation-name: gyro-4;
  animation-duration: 4s;
}

.gyro-core {
  position: absolute;
  inset: 42%;
  border-radius: 50%;
  background: var(--gyro-color);
  box-shadow: 0 0 24px var(--gyro-color);
  transition:
    background-color 600ms ease,
    box-shadow 600ms ease;
}

@keyframes gyro-1 {
  from {
    transform: rotateX(70deg) rotateZ(0deg);
  }
  to {
    transform: rotateX(70deg) rotateZ(360deg);
  }
}

@keyframes gyro-2 {
  from {
    transform: rotateY(60deg) rotateZ(0deg);
  }
  to {
    transform: rotateY(60deg) rotateZ(360deg);
  }
}

@keyframes gyro-3 {
  from {
    transform: rotateX(0deg) rotateY(0deg);
  }
  to {
    transform: rotateX(360deg) rotateY(360deg);
  }
}

@keyframes gyro-4 {
  from {
    transform: rotateZ(0deg) rotateX(45deg) rotateY(0deg);
  }
  to {
    transform: rotateZ(360deg) rotateX(45deg) rotateY(360deg);
  }
}
```

- [ ] **Step 3: Render the gyroscope**

In `web/src/StatusPage.tsx`, add `import { Gyroscope } from './Gyroscope';`. Before `return (`, add:

```tsx
  const gyroState = !reachable || status?.status === 'degraded' ? 'error' : 'ok';
```

Make the gyroscope the first child of the header:

```tsx
      <header className="hero">
        <Gyroscope state={gyroState} />
        <h1 className="title">b24auth-server</h1>
```

- [ ] **Step 4: Typecheck, format and build**

Run: `npx prettier --write web && npm run web:typecheck && npm run web:build && npm run lint`
Expected: all PASS.

- [ ] **Step 5: Manual check in a browser**

Use the two terminals from Task 5, Step 12.

1. Make sure that four glowing cyan rings rotate continuously, each at its own speed and axis, above the title.
2. Stop the database: `docker compose stop db`. Within 30 seconds, make sure that the rings and core change to the soft red color with a smooth transition, and the database pill shows `down`.
3. Start the database again: `docker compose start db`. Make sure that the color returns to cyan.
4. Turn on "reduce motion" in the operating system (Windows: Settings → Accessibility → Visual effects → Animation effects off). Reload. Make sure that the rings are static and tilted and the content is the same.
5. In the browser DevTools Network tab, make sure that all requests go to the local host only.

- [ ] **Step 6: Commit**

```bash
git add web/src/Gyroscope.tsx web/src/status.css web/src/StatusPage.tsx
git commit -m "feat(web): add the gyroscope animation with an error color state"
```

---

### Task 7: Docker, CI and Dependabot

- [ ] Task 7 complete: Docker, CI and Dependabot

Checks off: **tasks.md 4.1, 4.2**

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/dependabot.yml`

**Interfaces:**
- Consumes: root scripts `web:install`, `web:typecheck`, `web:build` (Task 5); `webRoot` = `/app/public` (Task 4); `/api/status` (Task 3).

- [ ] **Step 1: Update the Dockerfile**

Replace the build stage and add one `COPY` to the runtime stage:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix web
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm run build --prefix web && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./public
COPY drizzle ./drizzle
USER node
EXPOSE 3000
ENTRYPOINT ["node", "dist/server.js"]
```

- [ ] **Step 2: Update `.dockerignore`**

Root patterns in `.dockerignore` match only at the top level. Add:

```
web/node_modules
web/dist
```

- [ ] **Step 3: Update the CI `test` job**

In `.github/workflows/ci.yml`, replace the `test` job steps (lines 30-39):

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: |
            package-lock.json
            web/package-lock.json
      - run: npm ci
      - run: npm run web:install
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run web:typecheck
      - run: npm test
      - run: npm run build
      - run: npm run web:build
```

- [ ] **Step 4: Extend the container smoke test**

In the `Smoke test` step, add after the line with `grep -q '"status":"ok"'`:

```yaml
          curl -fs http://localhost:3000/ | grep -q '<div id="root">'
          curl -fs http://localhost:3000/api/status | grep -q '"database":"ok"'
```

- [ ] **Step 5: Add the Dependabot entry**

In `.github/dependabot.yml`, add after the first `npm` entry:

```yaml
  - package-ecosystem: npm
    directory: /web
    schedule:
      interval: weekly
```

- [ ] **Step 6: Verify the image locally**

Run:

```bash
cp -n .env.example .env
docker compose up -d --build
curl -fs http://localhost:3000/ | grep -q '<div id="root">' && echo page-ok
curl -fs http://localhost:3000/api/status | grep -q '"database":"ok"' && echo status-ok
curl -fsI http://localhost:3000/ | grep -i content-security-policy
docker compose down
```

Expected: `page-ok`, `status-ok` and the CSP header line. If `.env` already exists, make sure it has `BASE_URL=http://localhost:3000` and `PORTAL_ALLOWLIST=portal.test`. If Docker is not available, write this in the task report; the CI `container` job runs the same checks.

- [ ] **Step 7: Run the format check**

Run: `npm run lint`
Expected: PASS (Prettier checks the YAML files).

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore .github/workflows/ci.yml .github/dependabot.yml
git commit -m "build: build the web UI in Docker and CI, and watch web/ with Dependabot"
```

---

### Task 8: Documentation

- [ ] Task 8 complete: Documentation

Checks off: **tasks.md 4.3**

**Files:**
- Modify: `docs/deployment.md` (sections 3, 4, 8)
- Modify: `README.md` (features table row "Operations", limits list "No user interface", CI smoke-test row)

**Interfaces:**
- Consumes: final behavior of Tasks 1-7.

- [ ] **Step 1: Update `docs/deployment.md` section 3**

Replace the sentence `Check: \`curl https://auth.corp.local/health\` → \`{"status":"ok"}\`.` (line 41) with:

```markdown
Check: `curl https://auth.corp.local/health` → `{"status":"ok"}`. `/health` runs `SELECT 1`
against PostgreSQL. If the database does not answer within 2 seconds, `/health` returns HTTP 503
and `{"status":"error","database":"down"}`. Monitors and health checks that expect HTTP 200 in
all cases must accept this change.
```

- [ ] **Step 2: Update `docs/deployment.md` section 4**

Replace the first bullet under "Restrict access at the proxy" with:

```markdown
- Deny by default. Allow every path only from the portal servers' IP addresses, except
  `/oauth/token` and `/health`, which application servers and monitoring may reach, and the
  public status page: `/`, `/assets/*` and `/api/status`. The status page shows aggregate counts
  only. If the counts must stay internal, restrict these paths like the others.
```

Replace the nginx example with:

```nginx
    location ~ ^/(oauth/token|health|api/status)/?$ {
        proxy_pass http://127.0.0.1:3000;
    }
    location = / {
        proxy_pass http://127.0.0.1:3000;
    }
    location /assets/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        allow 10.0.0.10;   # portal server(s)
        deny  all;
        proxy_pass http://127.0.0.1:3000;
    }
```

Keep the four-space indentation of the existing example (it is an indented code block, not a fenced one).

- [ ] **Step 3: Update `docs/deployment.md` section 8**

Add at the end of section 8:

```markdown
The server counts delivered, failed and dropped deliveries per UTC day in the table
`event_counters`. The status page and `GET /api/status` show the counts for today and for the
last 7 days. The counters store no event content, handler URL, portal or application.
```

- [ ] **Step 4: Update `README.md`**

1. In the features table, replace the cell text of the **Operations** row with:

   ```markdown
   A public status page at `/` (service and database state, counts of portals, applications, active token pairs and event deliveries) and the same data as JSON at `/api/status`. `/health` returns HTTP 503 when PostgreSQL does not answer. JSON logs, trailing slashes accepted on all paths.
   ```

2. In the limits list, replace the bullet that starts with **No user interface.** with:

   ```markdown
   - **Status page only.** The UI is a read-only status page at `/`. There is no admin interface yet.
   ```

3. In the checks table, replace the cell text of the **Container smoke test (CI)** row with:

   ```markdown
   The container starts, `/health` answers, the status page and `/api/status` answer, a portal registers, no error-level logs, the process does not run as root.
   ```

- [ ] **Step 5: Format and check**

Run: `npx prettier --write README.md && npm run lint`
Expected: PASS. (`docs/` is in `.prettierignore`.)

- [ ] **Step 6: Commit**

```bash
git add docs/deployment.md README.md
git commit -m "docs: describe the status page, proxy paths and the new /health behavior"
```

---

## Final verification

- [ ] Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run web:typecheck && npm run web:build`
  Expected: all PASS.
- [ ] Mark all items in `docs/openspec/changes/public-status-page/tasks.md` as done.

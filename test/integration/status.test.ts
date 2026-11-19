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

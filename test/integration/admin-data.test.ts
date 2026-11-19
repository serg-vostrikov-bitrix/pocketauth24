import { afterEach, beforeEach, expect, it } from 'vitest';
import { applications, portals } from '../../src/schema.js';
import {
  addApp,
  createSuperuser,
  loginAs,
  OTHER_PORTAL,
  PORTAL,
  registerPortal,
  startApp,
  SUPERUSER,
  truncateAll,
  type TestApp,
} from '../helpers.js';

type PageBody = {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
};

let t: TestApp;
let cookie: string;
beforeEach(async () => {
  t = await startApp();
  await truncateAll(t.db);
  await createSuperuser(t.db);
  cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
});
afterEach(async () => {
  await t.close();
});

async function list(path: string, query: Record<string, string> = {}, asCookie = cookie) {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/admin/${path}`,
    query,
    headers: { cookie: asCookie },
  });
  return { status: res.statusCode, body: res.json<PageBody>(), text: res.body };
}

it('GET /portals returns the documented fields and no secret', async () => {
  const portal = await registerPortal(t.app);
  await addApp(t.app, portal);
  const res = await list('portals');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 50 });
  const [row] = res.body.rows;
  expect(Object.keys(row).sort()).toEqual([
    'applications',
    'clientId',
    'createdAt',
    'id',
    'origin',
  ]);
  expect(row).toMatchObject({ origin: PORTAL, clientId: portal.client_id, applications: 1 });
  const [stored] = await t.db.select({ secretHash: portals.secretHash }).from(portals);
  expect(res.text).not.toMatch(/secret/i);
  expect(res.text).not.toContain(stored.secretHash);
});

it('GET /applications returns the documented fields and no secret', async () => {
  const portal = await registerPortal(t.app);
  const app = await addApp(t.app, portal);
  const res = await list('applications');
  const [row] = res.body.rows;
  expect(Object.keys(row).sort()).toEqual([
    'clientId',
    'createdAt',
    'id',
    'portal',
    'redirectUri',
    'scope',
    'title',
  ]);
  expect(row).toMatchObject({ portal: PORTAL, clientId: app.client_id, title: 'Demo app' });
  const [stored] = await t.db.select({ secretHash: applications.secretHash }).from(applications);
  expect(res.text).not.toMatch(/secret/i);
  expect(res.text).not.toContain(stored.secretHash);
});

it('Data routes need a session', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/admin/portals' });
  expect(res.statusCode).toBe(401);
});

it('Text filters match a case-insensitive substring and combine with AND', async () => {
  const first = await registerPortal(t.app);
  const second = await registerPortal(t.app, `${OTHER_PORTAL}/`);
  const fields = { REDIRECT_URI: 'https://app.test/handler', SCOPE: 'crm' };
  await addApp(t.app, first, { ...fields, TITLE: 'Demo app' });
  await addApp(t.app, first, { ...fields, TITLE: 'Other app' });
  await addApp(t.app, second, { ...fields, TITLE: 'Other app' });
  const res = await list('applications', {
    'filter[portal]': 'PORTAL.TEST',
    'filter[title]': 'other',
  });
  expect(res.body.total).toBe(1);
  expect(res.body.rows[0]).toMatchObject({ portal: PORTAL, title: 'Other app' });
});

it('An injection string is plain text', async () => {
  await registerPortal(t.app);
  const res = await list('portals', { 'filter[origin]': "' OR 1=1 --" });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ total: 0, rows: [] });
  expect(await t.db.$count(portals)).toBe(1);
});

it('A percent sign in a filter matches a literal percent sign', async () => {
  await t.db.insert(portals).values([
    { origin: 'https://x.test/100%', clientId: 'c1', secretHash: 'x' },
    { origin: 'https://x.test/1000', clientId: 'c2', secretHash: 'x' },
  ]);
  const res = await list('portals', { 'filter[origin]': '100%' });
  expect(res.body.rows.map((r) => r.origin)).toEqual(['https://x.test/100%']);
});

it('An invalid id filter returns 400 with the column', async () => {
  const res = await list('portals', { 'filter[id]': 'abc' });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid_filter', column: 'id' });
});

it('A date range includes the whole "to" day', async () => {
  await t.db.insert(portals).values(
    ['2026-01-01', '2026-01-02', '2026-01-03'].map((day, i) => ({
      origin: `https://d${i}.test`,
      clientId: `d${i}`,
      secretHash: 'x',
      createdAt: new Date(`${day}T12:00:00Z`),
    })),
  );
  const res = await list('portals', {
    'filter[createdAt.from]': '2026-01-02',
    'filter[createdAt.to]': '2026-01-02',
  });
  expect(res.body.rows.map((r) => r.origin)).toEqual(['https://d1.test']);
});

it('Pages hold 50 rows, newest first, with the total', async () => {
  const base = Date.parse('2026-01-01T00:00:00Z');
  await t.db.insert(portals).values(
    Array.from({ length: 51 }, (_, i) => ({
      origin: `https://p${i}.test`,
      clientId: `p${i}`,
      secretHash: 'x',
      createdAt: new Date(base + i * 60_000),
    })),
  );
  const first = await list('portals');
  expect(first.body).toMatchObject({ total: 51, page: 1, pageSize: 50 });
  expect(first.body.rows).toHaveLength(50);
  expect(first.body.rows[0].origin).toBe('https://p50.test');
  const second = await list('portals', { page: '2' });
  expect(second.body.rows.map((r) => r.origin)).toEqual(['https://p0.test']);
  const beyond = await list('portals', { page: '3' });
  expect(beyond.body).toMatchObject({ total: 51, page: 3, rows: [] });
});

it('An id filter beyond the integer range returns 400, not 500', async () => {
  const res = await list('applications', { 'filter[id]': '99999999999999999999' });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid_filter', column: 'id' });
});

it('A date that does not exist returns 400, not 500', async () => {
  const res = await list('portals', { 'filter[createdAt.from]': '2026-02-30' });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid_filter', column: 'createdAt' });
});

it('A viewer session can read the data routes', async () => {
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    payload: { login: 'viewer1' },
    headers: { cookie },
  });
  expect(created.statusCode).toBe(201);
  const viewerCookie = await loginAs(
    t.app,
    'viewer1',
    created.json<{ password: string }>().password,
  );
  await registerPortal(t.app);
  const res = await list('portals', {}, viewerCookie);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 50 });
});

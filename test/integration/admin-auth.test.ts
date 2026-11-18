import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deleteExpiredSessions } from '../../src/admin/sessions.js';
import { adminSessions } from '../../src/schema.js';
import {
  createSuperuser,
  loginAs,
  startApp,
  SUPERUSER,
  truncateAll,
  type TestApp,
} from '../helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await startApp();
  await truncateAll(t.db);
});
afterEach(async () => {
  await t.close();
});

const login = (body: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: '/api/admin/login', payload: body });
const me = (cookie?: string) =>
  t.app.inject({ method: 'GET', url: '/api/admin/me', headers: cookie ? { cookie } : {} });
const logout = (cookie: string) =>
  t.app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie }, payload: {} });

it('Login without a superuser returns 503 with the CLI command', async () => {
  const res = await login({ login: 'admin', password: 'any-password-123' });
  expect(res.statusCode).toBe(503);
  expect(res.json()).toEqual({
    error: 'no_superuser',
    hint: 'docker compose exec app node dist/cli.js superuser set-password',
  });
});

it('A protected route without a session returns 401 and no-store', async () => {
  await createSuperuser(t.db);
  const res = await me();
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual({ error: 'unauthorized' });
  expect(res.headers['cache-control']).toBe('no-store');
});

it('A successful login sets the session cookie and stores only its hash', async () => {
  await createSuperuser(t.db);
  const res = await login(SUPERUSER);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ login: 'admin', role: 'superuser' });
  const header = String(res.headers['set-cookie']);
  expect(header).toMatch(/^b24a_session=[A-Za-z0-9_-]{43};/);
  for (const flag of ['Max-Age=43200', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure']) {
    expect(header).toContain(flag);
  }
  const cookie = header.split(';')[0];
  const res2 = await me(cookie);
  expect(res2.statusCode).toBe(200);
  expect(res2.json()).toEqual({ login: 'admin', role: 'superuser' });
  const [row] = await t.db.select().from(adminSessions);
  expect(row.idHash).toMatch(/^[0-9a-f]{64}$/);
  expect(header).not.toContain(row.idHash);
});

it('A wrong password and an unknown login give the same 401', async () => {
  await createSuperuser(t.db);
  const wrong = await login({ login: 'admin', password: 'wrong-password-1' });
  const unknown = await login({ login: 'nobody', password: 'wrong-password-1' });
  expect(wrong.statusCode).toBe(401);
  expect(unknown.statusCode).toBe(401);
  expect(wrong.json()).toEqual({ error: 'invalid_credentials' });
  expect(unknown.body).toBe(wrong.body);
});

it('An expired session returns 401', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  await t.db.update(adminSessions).set({ expiresAt: new Date(Date.now() - 1000) });
  expect((await me(cookie)).statusCode).toBe(401);
});

it('Logout returns 204, clears the cookie and ends the session', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const res = await logout(cookie);
  expect(res.statusCode).toBe(204);
  expect(String(res.headers['set-cookie'])).toContain('b24a_session=;');
  expect((await me(cookie)).statusCode).toBe(401);
});

it('A form-encoded write gets 415 and changes nothing', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/logout',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'a=1',
  });
  expect(res.statusCode).toBe(415);
  expect(res.json()).toEqual({ error: 'unsupported_media_type' });
  expect((await me(cookie)).statusCode).toBe(200);
});

it('Login events log the login and the IP, and no password or session ID', async () => {
  await createSuperuser(t.db);
  await login({ login: 'admin', password: 'wrong-password-1' });
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  await logout(cookie);
  for (const msg of ['admin_login_failed', 'admin_login_succeeded', 'admin_logout']) {
    expect(t.logs.find((l) => l.msg === msg)).toMatchObject({ login: 'admin', ip: '127.0.0.1' });
  }
  const text = JSON.stringify(t.logs);
  expect(text).not.toContain('wrong-password-1');
  expect(text).not.toContain(SUPERUSER.password);
  expect(text).not.toContain(cookie.split('=')[1]);
});

it('A write without a session gets 401 before the body is parsed', async () => {
  await createSuperuser(t.db);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/logout',
    headers: { 'content-type': 'application/json' },
    payload: '{not json',
  });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual({ error: 'unauthorized' });
});

it('An unknown admin path returns 404 and no-store', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/admin/nope' });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: 'not_found' });
  expect(res.headers['cache-control']).toBe('no-store');
});

it('The JSON guard ignores the case of the content type', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/logout',
    headers: { cookie, 'content-type': 'Application/JSON' },
    payload: '{}',
  });
  expect(res.statusCode).toBe(204);
});

it('A write with no content type or text/plain gets 415', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const none = await t.app.inject({
    method: 'POST',
    url: '/api/admin/logout',
    headers: { cookie },
  });
  const text = await t.app.inject({
    method: 'POST',
    url: '/api/admin/logout',
    headers: { cookie, 'content-type': 'text/plain' },
    payload: '{}',
  });
  expect(none.statusCode).toBe(415);
  expect(text.statusCode).toBe(415);
  expect((await me(cookie)).statusCode).toBe(200);
});

it('Logout clears the cookie with the same attributes', async () => {
  await createSuperuser(t.db);
  const cookie = await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const header = String((await logout(cookie)).headers['set-cookie']);
  for (const flag of ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure']) {
    expect(header).toContain(flag);
  }
});

it('The sixth login after five failures gets 429 without a password check', async () => {
  await createSuperuser(t.db);
  for (let i = 0; i < 5; i++) {
    expect((await login({ login: 'admin', password: `wrong-password-${i}` })).statusCode).toBe(401);
  }
  const res = await login(SUPERUSER);
  expect(res.statusCode).toBe(429);
  expect(res.json()).toEqual({ error: 'too_many_attempts' });
});

it('A successful login clears earlier failures', async () => {
  await createSuperuser(t.db);
  for (let i = 0; i < 4; i++) await login({ login: 'admin', password: `wrong-password-${i}` });
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  for (let i = 0; i < 4; i++) {
    expect((await login({ login: 'admin', password: `wrong-password-${i}` })).statusCode).toBe(401);
  }
});

it('deleteExpiredSessions deletes only expired sessions', async () => {
  await createSuperuser(t.db);
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
  const [first] = await t.db.select().from(adminSessions).limit(1);
  await t.db
    .update(adminSessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(adminSessions.idHash, first.idHash));
  await deleteExpiredSessions(t.db, new Date());
  expect(await t.db.$count(adminSessions)).toBe(1);
});

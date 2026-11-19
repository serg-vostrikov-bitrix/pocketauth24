import { afterEach, beforeEach, expect, it } from 'vitest';
import { adminSessions, adminUsers } from '../../src/schema.js';
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

it('The database rejects a second superuser and accepts many viewers', async () => {
  await t.db.insert(adminUsers).values({ login: 'root', passwordHash: 'x', role: 'superuser' });
  await expect(
    t.db.insert(adminUsers).values({ login: 'root2', passwordHash: 'x', role: 'superuser' }),
  ).rejects.toThrow();
  await t.db.insert(adminUsers).values([
    { login: 'viewer1', passwordHash: 'x', role: 'viewer' },
    { login: 'viewer2', passwordHash: 'x', role: 'viewer' },
  ]);
  expect(await t.db.$count(adminUsers)).toBe(3);
});

it('Deleting an admin user deletes its sessions', async () => {
  const [user] = await t.db
    .insert(adminUsers)
    .values({ login: 'viewer1', passwordHash: 'x', role: 'viewer' })
    .returning({ id: adminUsers.id });
  await t.db
    .insert(adminSessions)
    .values({ idHash: 'a'.repeat(64), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
  await t.db.delete(adminUsers);
  expect(await t.db.$count(adminSessions)).toBe(0);
});

type Created = { id: number; login: string; password: string };

const send = (cookie: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  t.app.inject({
    method,
    url: `/api/admin${url}`,
    headers: { cookie },
    payload: method === 'GET' ? undefined : (payload ?? {}),
  });

async function superuserCookie(): Promise<string> {
  await createSuperuser(t.db);
  return loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
}

async function createViewer(cookie: string, login = 'viewer1'): Promise<Created> {
  const res = await send(cookie, 'POST', '/users', { login });
  expect(res.statusCode).toBe(201);
  return res.json<Created>();
}

it('The superuser creates a viewer who can log in', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  expect(viewer.login).toBe('viewer1');
  expect(viewer.password).toMatch(/^[A-Za-z0-9]{20}$/);
  const cookie = await loginAs(t.app, viewer.login, viewer.password);
  expect((await send(cookie, 'GET', '/me')).json()).toEqual({ login: 'viewer1', role: 'viewer' });

  const list = (await send(su, 'GET', '/users')).json<Record<string, unknown>[]>();
  expect(list.map((u) => [u.login, u.role])).toEqual([
    ['admin', 'superuser'],
    ['viewer1', 'viewer'],
  ]);
  expect(Object.keys(list[1]).sort()).toEqual(['createdAt', 'id', 'login', 'role']);
});

it('A password reset returns a new password and ends the old sessions', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  const oldCookie = await loginAs(t.app, viewer.login, viewer.password);

  const res = await send(su, 'POST', `/users/${viewer.id}/password`);
  expect(res.statusCode).toBe(200);
  const { password } = res.json<{ password: string }>();
  expect(password).toMatch(/^[A-Za-z0-9]{20}$/);
  expect(password).not.toBe(viewer.password);

  expect((await send(oldCookie, 'GET', '/me')).statusCode).toBe(401);
  const oldLogin = await t.app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { login: viewer.login, password: viewer.password },
  });
  expect(oldLogin.statusCode).toBe(401);
  await loginAs(t.app, viewer.login, password);
});

it('Delete ends the session of the viewer', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  const cookie = await loginAs(t.app, viewer.login, viewer.password);
  expect((await send(su, 'DELETE', `/users/${viewer.id}`)).statusCode).toBe(204);
  expect((await send(cookie, 'GET', '/me')).statusCode).toBe(401);
  expect((await send(su, 'GET', '/users')).json()).toHaveLength(1);
});

it('A viewer gets 403 on every user route', async () => {
  const su = await superuserCookie();
  const viewer = await createViewer(su);
  const cookie = await loginAs(t.app, viewer.login, viewer.password);
  const calls = [
    send(cookie, 'GET', '/users'),
    send(cookie, 'POST', '/users', { login: 'viewer2' }),
    send(cookie, 'POST', `/users/${viewer.id}/password`),
    send(cookie, 'DELETE', `/users/${viewer.id}`),
  ];
  for (const res of await Promise.all(calls)) {
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  }
  expect(await t.db.$count(adminUsers)).toBe(2);
});

it('The panel cannot change the superuser', async () => {
  const su = await superuserCookie();
  const [admin] = (await send(su, 'GET', '/users')).json<{ id: number }[]>();
  expect((await send(su, 'POST', `/users/${admin.id}/password`)).statusCode).toBe(403);
  expect((await send(su, 'DELETE', `/users/${admin.id}`)).statusCode).toBe(403);
  await loginAs(t.app, SUPERUSER.login, SUPERUSER.password);
});

it('Invalid login 400, duplicate login 409, missing user 404', async () => {
  const su = await superuserCookie();
  await createViewer(su);
  const invalid = await send(su, 'POST', '/users', { login: 'a b' });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toEqual({ error: 'invalid_login' });
  const duplicate = await send(su, 'POST', '/users', { login: 'viewer1' });
  expect(duplicate.statusCode).toBe(409);
  expect(duplicate.json()).toEqual({ error: 'login_taken' });
  expect((await send(su, 'POST', '/users/999/password')).statusCode).toBe(404);
  expect((await send(su, 'DELETE', '/users/999')).statusCode).toBe(404);
});

it('A form-encoded POST /users gets 415 and creates nothing', async () => {
  const su = await superuserCookie();
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: su, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'login=intruder',
  });
  expect(res.statusCode).toBe(415);
  expect(await t.db.$count(adminUsers)).toBe(1);
});

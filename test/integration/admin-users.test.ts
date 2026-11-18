import { afterEach, beforeEach, expect, it } from 'vitest';
import { adminSessions, adminUsers } from '../../src/schema.js';
import { startApp, truncateAll, type TestApp } from '../helpers.js';

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

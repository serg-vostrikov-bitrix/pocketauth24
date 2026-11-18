import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerPortal, rpc, startApp, truncateAll, type TestApp } from '../helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await truncateAll(t.db);
});

describe('application-registry', () => {
  it('Status sync', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.list');
    expect(res.body).toEqual({ result: [] });
  });
});

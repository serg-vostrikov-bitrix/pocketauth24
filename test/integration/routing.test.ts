import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { form, registerPortal, startApp, truncateAll, type TestApp } from '../helpers.js';

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

describe('routing', () => {
  it('Portal RPC with a trailing slash and request id', async () => {
    const portal = await registerPortal(t.app);

    const res = await t.app.inject({
      method: 'POST',
      url: '/rest/application.list/?bx24_request_id=abc',
      ...form({ ...portal }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: [] });
  });

  it('Token endpoint without a trailing slash', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/oauth/token?grant_type=password' });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');
  });

  it('Registration with a trailing slash still works', async () => {
    const creds = await registerPortal(t.app);

    expect(creds.client_id).toBeTruthy();
  });

  it('Unknown path answers in the Bitrix error shape', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found', error_description: 'Not found' });
  });
});

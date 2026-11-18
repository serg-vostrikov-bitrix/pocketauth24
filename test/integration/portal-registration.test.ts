import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { portals } from '../../src/schema.js';
import { form, PORTAL, startApp, truncateAll, type TestApp } from '../helpers.js';

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

describe('portal-registration', () => {
  it('Allowed portal registers', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/oauth/register/',
      ...form({ redirect_uri: `${PORTAL}/`, type: 'B', member_id: 'abc', BX_TYPE: 'x' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ client_id: string; client_secret: string }>();
    expect(body.client_id).toMatch(/^[0-9a-f]{32}$/);
    expect(body.client_secret).toMatch(/^[0-9a-f]{64}$/);
    const rows = await t.db.select().from(portals);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: PORTAL, clientId: body.client_id });
    expect(rows[0].secretHash).not.toBe(body.client_secret);
  });

  it('Unknown portal is rejected', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/oauth/register/',
      ...form({ redirect_uri: 'https://evil.test/', type: 'B' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'access_denied',
      error_description: expect.any(String) as string,
    });
    expect(await t.db.select().from(portals)).toHaveLength(0);
  });
});

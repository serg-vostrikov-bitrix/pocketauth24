import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applications, portals } from '../../src/schema.js';
import {
  form,
  PORTAL,
  registerPortal,
  rpc,
  startApp,
  truncateAll,
  type TestApp,
} from '../helpers.js';

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
    const body = res.json<{ client_id: string; client_secret: string; host: string }>();
    expect(body.host).toBe('portal.test');
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

  it('Portal re-registers', async () => {
    const first = await registerPortal(t.app);
    const [before] = await t.db.select().from(portals);
    await t.db.insert(applications).values({
      portalId: before.id,
      clientId: 'local.00000000000000.00000001',
      secretHash: 'kept',
      title: 'Kept app',
      redirectUri: '',
      scope: 'crm',
    });

    const second = await registerPortal(t.app);

    expect(second.client_id).not.toBe(first.client_id);
    const after = await t.db.select().from(portals);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect((await rpc(t.app, first, 'application.list')).body.error).toBe('invalid_client');
    expect((await rpc(t.app, second, 'application.list')).body).toEqual({ result: [] });
    expect(await t.db.select().from(applications)).toHaveLength(1);
  });

  it('Valid service credentials', async () => {
    const creds = await registerPortal(t.app);
    const res = await rpc(t.app, creds, 'application.list', {
      client_redirect_uri: `${PORTAL}/`,
      member_id: 'ignored',
      bx24_request_id: 'ignored',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: [] });
  });

  it('Invalid service credentials', async () => {
    const creds = await registerPortal(t.app);
    const unknown = await rpc(
      t.app,
      { client_id: 'nope', client_secret: 'nope' },
      'application.list',
    );
    const wrongSecret = await rpc(t.app, { ...creds, client_secret: 'wrong' }, 'application.list');
    for (const res of [unknown, wrongSecret]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
      expect(res.body.result).toBeUndefined();
    }
  });

  it('Unknown method', async () => {
    const creds = await registerPortal(t.app);
    const res = await rpc(t.app, creds, 'application.install');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ERROR_METHOD_NOT_FOUND');
  });
});

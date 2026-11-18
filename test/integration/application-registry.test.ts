import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applications } from '../../src/schema.js';
import {
  addApp,
  APP_FIELDS,
  authorize,
  registerPortal,
  rpc,
  startApp,
  truncateAll,
  type Credentials,
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

describe('application-registry', () => {
  it('Status sync', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.list');
    expect(res.body).toEqual({ result: [] });
  });

  it('Portal creates a local app', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc<Credentials>(t.app, portal, 'application.add', APP_FIELDS);
    expect(res.status).toBe(200);
    const created = res.body.result;
    expect(created?.client_id).toMatch(/^local\.[0-9a-f]{14}\.\d{8}$/);
    expect(created?.client_secret).toMatch(/^[0-9a-f]{64}$/);
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientId: created?.client_id,
      title: 'Demo app',
      redirectUri: 'https://app.test/handler',
      scope: 'crm,user',
    });
    expect(rows[0].secretHash).not.toBe(created?.client_secret);
  });

  it('Local app is usable immediately', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);
    expect(token.access_token).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applications } from '../../src/schema.js';
import {
  addApp,
  APP_FIELDS,
  authorize,
  OTHER_PORTAL,
  registerPortal,
  rpc,
  startApp,
  tokenRequest,
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
    expect(created).toMatchObject({ redirect_uri: 'https://app.test/handler', scope: 'crm,user' });
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

  it('Scope update applies to new tokens', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);

    const updated = await rpc(t.app, portal, 'application.update', {
      CLIENT_ID: app.client_id,
      TITLE: 'Demo app',
      REDIRECT_URI: 'https://app.test/handler',
      SCOPE: 'crm',
    });
    const token = await authorize(t.app, portal, app.client_id, { SCOPE: 'crm,user' });

    expect(updated.body).toEqual({ result: true });
    expect(token.scope).toBe('crm');
  });

  it('Delete removes tokens', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);
    // Negative control: the token works before the delete.
    expect(
      (await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token })).body.result,
    ).toBeDefined();

    const deleted = await rpc(t.app, portal, 'application.delete', { CLIENT_ID: app.client_id });
    const checked = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });
    const renewed = await tokenRequest(t.app, 'POST', {
      grant_type: 'refresh_token',
      client_id: app.client_id,
      client_secret: app.client_secret,
      refresh_token: token.refresh_token,
    });

    expect(deleted.body).toEqual({ result: true });
    expect(checked.body.error).toBe('invalid_token');
    expect(renewed.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('Foreign application', async () => {
    const portal = await registerPortal(t.app);
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    const foreignApp = await addApp(t.app, other);

    const updated = await rpc(t.app, portal, 'application.update', {
      CLIENT_ID: foreignApp.client_id,
      TITLE: 'Hijacked',
      SCOPE: 'disk',
    });
    const deleted = await rpc(t.app, portal, 'application.delete', {
      CLIENT_ID: foreignApp.client_id,
    });

    for (const res of [updated, deleted]) {
      expect(res.body).toEqual({
        error: 'ERROR_OAUTH',
        error_description: 'Application not found',
      });
    }
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Demo app', scope: 'crm,user' });
  });
});

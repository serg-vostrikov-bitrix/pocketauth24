import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applications, marketplaceApps } from '../../src/schema.js';
import {
  addApp,
  addCatalogEntry,
  APP_FIELDS,
  authorize,
  CATALOG_APP,
  install,
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

describe('application-registry: Marketplace install', () => {
  it('Install from the Marketplace', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    const res = await install(t.app, portal, 'app.a1.1', {
      CHECK_HASH: 'ignored',
      INSTALL_HASH: 'ignored',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      result: { client_id: 'app.a1.1', version: 3, status: 'F', scope: ['crm', 'user'] },
    });
    const [entry] = await t.db.select().from(marketplaceApps);
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientId: 'app.a1.1',
      secretHash: null,
      title: 'Partner app',
      redirectUri: '',
      scope: 'crm,user',
      marketplaceAppId: entry.id,
    });
  });

  it('Repeated install', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);
    const [before] = await t.db.select().from(applications);
    const token = await authorize(t.app, portal, 'app.a1.1');
    await addCatalogEntry(t.db, { ...CATALOG_APP, title: 'Renamed', scope: 'crm' });

    const again = await install(t.app, portal);

    expect(again.body.result).toEqual({
      client_id: 'app.a1.1',
      version: 3,
      status: 'F',
      scope: ['crm'],
    });
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before.id, title: 'Renamed', scope: 'crm' });
    const checked = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });
    expect(checked.status).toBe(200);
  });

  it('Entry serves all portals', async () => {
    await addCatalogEntry(t.db);
    const first = await registerPortal(t.app);
    const second = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    expect((await install(t.app, first)).status).toBe(200);
    expect((await install(t.app, second)).status).toBe(200);
    expect(await t.db.$count(applications)).toBe(2);
  });

  it('Application of another vendor', async () => {
    const portal = await registerPortal(t.app);
    const res = await install(t.app, portal, 'app.other.1');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'ERROR_OAUTH',
      error_description: 'Application is not in the PocketAuth24 catalog',
    });
    expect(await t.db.$count(applications)).toBe(0);
    expect(t.logs.find((l) => l.reason === 'client_id_not_in_catalog')).toMatchObject({
      msg: 'request_failed',
    });
  });

  it('Subscription install', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.install.subscription', {
      CLIENT_ID: 'app.a1.1',
      VERSION: 3,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'ERROR_OAUTH',
      error_description: 'Subscription applications are not supported',
    });
    expect(await t.db.$count(applications)).toBe(0);
    expect(t.logs.find((l) => l.reason === 'subscription_not_supported')).toMatchObject({
      msg: 'request_failed',
    });
  });
});

describe('application-registry: Marketplace uninstall', () => {
  it('Uninstall removes tokens', async () => {
    await addCatalogEntry(t.db);
    const first = await registerPortal(t.app);
    const second = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    await install(t.app, first);
    await install(t.app, second);
    const firstToken = await authorize(t.app, first, 'app.a1.1');
    const secondToken = await authorize(t.app, second, 'app.a1.1');

    const res = await rpc(t.app, first, 'application.uninstall', { CLIENT_ID: 'app.a1.1' });

    expect(res.body).toEqual({ result: true });
    const checked = await rpc(t.app, first, 'rest.check', { TOKEN: firstToken.access_token });
    expect(checked.body.error).toBe('invalid_token');
    const renewed = await tokenRequest(t.app, 'POST', {
      grant_type: 'refresh_token',
      client_id: 'app.a1.1',
      client_secret: CATALOG_APP.secret,
      refresh_token: firstToken.refresh_token,
    });
    expect(renewed.statusCode).toBe(400);
    const other = await rpc(t.app, second, 'rest.check', { TOKEN: secondToken.access_token });
    expect(other.status).toBe(200);
    expect(await t.db.$count(marketplaceApps)).toBe(1);
  });

  it('Uninstall of a missing install returns true', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.uninstall', { CLIENT_ID: 'app.a1.1' });
    expect(res.body).toEqual({ result: true });
  });

  it('Uninstall does not delete a local application', async () => {
    const portal = await registerPortal(t.app);
    const local = await addApp(t.app, portal);
    const res = await rpc(t.app, portal, 'application.uninstall', { CLIENT_ID: local.client_id });
    expect(res.body).toEqual({ result: true });
    expect(await t.db.$count(applications)).toBe(1);
  });

  it.each(['application.update', 'application.delete'])(
    '%s does not change a Marketplace install',
    async (method) => {
      await addCatalogEntry(t.db);
      const portal = await registerPortal(t.app);
      await install(t.app, portal);
      const res = await rpc(t.app, portal, method, { CLIENT_ID: 'app.a1.1', TITLE: 'Changed' });
      expect(res.body).toEqual({
        error: 'ERROR_OAUTH',
        error_description: 'Application not found',
      });
      const [row] = await t.db.select().from(applications);
      expect(row).toMatchObject({ clientId: 'app.a1.1', title: 'Partner app' });
    },
  );
});

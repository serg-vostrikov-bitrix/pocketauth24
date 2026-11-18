import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenPairs } from '../../src/schema.js';
import {
  addApp,
  authorize,
  md5,
  OTHER_PORTAL,
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
afterEach(() => {
  vi.useRealTimers();
});

describe('token-service', () => {
  it('Fields present', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const before = Math.floor(Date.now() / 1000);

    const token = await authorize(t.app, portal, app.client_id);

    expect(Object.keys(token).sort()).toEqual(
      [
        'access_token',
        'client_endpoint',
        'domain',
        'expires',
        'expires_in',
        'member_id',
        'refresh_token',
        'scope',
        'server_endpoint',
        'status',
        'user_id',
      ].sort(),
    );
    expect(token).toMatchObject({
      expires_in: 3600,
      scope: 'crm,user',
      domain: 'portal.test',
      server_endpoint: 'https://auth.test/rest/',
      client_endpoint: 'https://portal.test/rest/',
      member_id: md5(portal.client_id),
      user_id: 5,
      status: 'L',
    });
    expect(token.access_token).toMatch(/^[0-9a-f]{64}$/);
    expect(token.refresh_token).toMatch(/^[0-9a-f]{64}$/);
    expect(token.expires).toBeGreaterThanOrEqual(before + 3600);
    expect(token.expires).toBeLessThanOrEqual(before + 3602);
    const [pair] = await t.db.select().from(tokenPairs);
    expect(pair.refreshExpiresAt.getTime() - pair.accessExpiresAt.getTime()).toBe(
      (180 * 24 * 3600 - 3600) * 1000,
    );
  });

  it('App page opens', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const params = { LOCAL_USER: '5', TZ_OFFSET: '10800', EVENT_SESSION: { id: 'abc' } };

    const token = await authorize(t.app, portal, app.client_id, { PARAMS: params });

    expect(token.user_id).toBe(5);
    const [pair] = await t.db.select().from(tokenPairs);
    expect(pair.userId).toBe(5);
    expect(pair.params).toEqual(params);
  });

  it('Unknown application', async () => {
    const portal = await registerPortal(t.app);
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    const foreignApp = await addApp(t.app, other);

    const res = await rpc(t.app, portal, 'rest.authorize', {
      CLIENT_ID: foreignApp.client_id,
      PARAMS: { LOCAL_USER: '1' },
    });

    expect(res.body).toEqual({
      error: 'ERROR_OAUTH',
      error_description: 'Application not installed',
    });
    expect(await t.db.select().from(tokenPairs)).toHaveLength(0);
  });

  it('Database leak', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);

    const dump = await t.db.execute(sql`SELECT * FROM token_pairs`);
    const text = JSON.stringify(dump.rows);

    expect(dump.rows).toHaveLength(1);
    expect(text).not.toContain(token.access_token);
    expect(text).not.toContain(token.refresh_token);
  });

  it('Valid token', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);

    const res = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });

    expect(res.body).toEqual({
      result: {
        client_id: app.client_id,
        expires: token.expires,
        scope: 'crm,user',
        member_id: token.member_id,
        user_id: 5,
        parameters: { LOCAL_USER: '5', TZ_OFFSET: '10800' },
      },
    });
  });

  it('Unknown or foreign token', async () => {
    const portal = await registerPortal(t.app);
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    const otherApp = await addApp(t.app, other);
    const foreign = await authorize(t.app, other, otherApp.client_id);
    // Negative control: the token is valid on its own portal, so the denial below is
    // caused by portal scoping, not by a broken token.
    expect(
      (await rpc(t.app, other, 'rest.check', { TOKEN: foreign.access_token })).body.result,
    ).toBeDefined();

    for (const tokenValue of ['0'.repeat(64), foreign.access_token]) {
      const res = await rpc(t.app, portal, 'rest.check', { TOKEN: tokenValue });
      expect(res.body.error).toBe('invalid_token');
      expect(res.body.result).toBeUndefined();
    }
  });

  it('Expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);

    vi.setSystemTime(Date.now() + 3600 * 1000);
    const res = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });

    expect(res.body.error).toBe('expired_token');
  });
});

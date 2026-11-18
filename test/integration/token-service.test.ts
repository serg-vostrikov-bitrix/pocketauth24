import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenPairs } from '../../src/schema.js';
import { deleteExpiredPairs, type RefreshResponse, type TokenResponse } from '../../src/tokens.js';
import {
  addApp,
  authorize,
  md5,
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
afterEach(() => {
  vi.useRealTimers();
});

async function issued(): Promise<{ portal: Credentials; app: Credentials; token: TokenResponse }> {
  const portal = await registerPortal(t.app);
  const app = await addApp(t.app, portal);
  const token = await authorize(t.app, portal, app.client_id);
  return { portal, app, token };
}

function refreshParams(app: Credentials, refreshToken: string): Record<string, string> {
  return {
    grant_type: 'refresh_token',
    client_id: app.client_id,
    client_secret: app.client_secret,
    refresh_token: refreshToken,
  };
}

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
      ].sort(),
    );
    expect(token).toMatchObject({
      expires_in: 3600,
      scope: 'crm,user',
      domain: 'portal.test',
      server_endpoint: 'https://auth.test/rest/',
      client_endpoint: 'https://portal.test/rest/',
      member_id: md5(portal.client_id),
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

    await authorize(t.app, portal, app.client_id, { PARAMS: params });

    const [pair] = await t.db.select().from(tokenPairs);
    expect(pair.userId).toBe(5);
    expect(pair.params).toEqual(params);
  });

  it.each(['1e20', '-1'])('Out-of-range LOCAL_USER %s is stored as 0', async (value) => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);

    await authorize(t.app, portal, app.client_id, { PARAMS: { LOCAL_USER: value } });

    const [pair] = await t.db.select().from(tokenPairs);
    expect(pair.userId).toBe(0);
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
        access_token: token.access_token,
        expires_in: 3600,
        expires: token.expires,
        scope: 'crm,user',
        client_id: app.client_id,
        parameters: { LOCAL_USER: 5, TZ_OFFSET: 10800 },
        status: 'L',
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
      expect(res.status).toBe(400);
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

  it('Successful renewal', async () => {
    const { portal, app, token } = await issued();

    const res = await tokenRequest(t.app, 'POST', refreshParams(app, token.refresh_token));

    expect(res.statusCode).toBe(200);
    const renewed = res.json<RefreshResponse>();
    expect(renewed).not.toHaveProperty('result');
    expect(renewed.access_token).not.toBe(token.access_token);
    expect(renewed.refresh_token).not.toBe(token.refresh_token);
    // The cloud answers a refresh with scope "app" and the OAuth server host as domain.
    expect(renewed).toMatchObject({ user_id: 5, scope: 'app', domain: 'auth.test' });
    const checked = await rpc(t.app, portal, 'rest.check', { TOKEN: renewed.access_token });
    expect(checked.body.result).toMatchObject({
      scope: 'crm,user',
      parameters: { LOCAL_USER: 5, TZ_OFFSET: 10800 },
    });
  });

  it('Refresh token reused', async () => {
    const { app, token } = await issued();

    const first = await tokenRequest(t.app, 'GET', refreshParams(app, token.refresh_token));
    const second = await tokenRequest(t.app, 'GET', refreshParams(app, token.refresh_token));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const a = first.json<RefreshResponse>();
    const b = second.json<RefreshResponse>();
    expect(b.access_token).not.toBe(a.access_token);
    expect(b).toMatchObject({ user_id: a.user_id, scope: a.scope });
    expect(a.user_id).toBe(5);
  });

  it('Refresh token expired or unknown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { app, token } = await issued();

    const unknown = await tokenRequest(t.app, 'POST', refreshParams(app, '0'.repeat(64)));
    vi.setSystemTime(Date.now() + 180 * 24 * 3600 * 1000);
    const expired = await tokenRequest(t.app, 'POST', refreshParams(app, token.refresh_token));

    for (const res of [unknown, expired]) {
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('invalid_grant');
    }
  });

  it('Wrong application secret', async () => {
    const { app, token } = await issued();

    const res = await tokenRequest(t.app, 'POST', {
      ...refreshParams(app, token.refresh_token),
      client_secret: 'wrong',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('authorization_code grant', async () => {
    const res = await tokenRequest(t.app, 'POST', {
      grant_type: 'authorization_code',
      client_id: 'x',
      client_secret: 'y',
      code: 'z',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_grant');
  });

  it('Query-string secrets stay out of the logs', async () => {
    const { app, token } = await issued();
    t.logs.length = 0;

    const res = await tokenRequest(t.app, 'GET', refreshParams(app, token.refresh_token));

    expect(res.statusCode).toBe(200);
    expect(t.logs.length).toBeGreaterThan(0);
    const logged = JSON.stringify(t.logs);
    expect(logged).not.toContain(app.client_secret);
    expect(logged).not.toContain(token.refresh_token);
  });

  it('Refresh token of another application', async () => {
    const { portal, token } = await issued();
    const other = await addApp(t.app, portal);

    const res = await tokenRequest(t.app, 'POST', refreshParams(other, token.refresh_token));

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_client');
  });

  it('Cleanup removes only pairs whose refresh token has expired', async () => {
    await issued();

    await deleteExpiredPairs(t.db, new Date());
    expect(await t.db.select().from(tokenPairs)).toHaveLength(1);

    await deleteExpiredPairs(t.db, new Date(Date.now() + 365 * 24 * 3600 * 1000));
    expect(await t.db.select().from(tokenPairs)).toHaveLength(0);
  });
});

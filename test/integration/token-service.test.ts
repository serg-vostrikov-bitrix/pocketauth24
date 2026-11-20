import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applications, portals, tokenPairs } from '../../src/schema.js';
import {
  deleteExpiredPairs,
  issuePair,
  type RefreshResponse,
  type TokenResponse,
} from '../../src/tokens.js';
import {
  addApp,
  addCatalogEntry,
  authorize,
  CATALOG_APP,
  install,
  md5,
  OTHER_PORTAL,
  registerPortal,
  rpc,
  startApp,
  TEST_CONFIG,
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
  async function installed(): Promise<{ portal: Credentials; token: TokenResponse }> {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);
    const token = await authorize(t.app, portal, 'app.a1.1');
    return { portal, token };
  }

  function catalogRefresh(refreshToken: string, secret: string = CATALOG_APP.secret) {
    return {
      grant_type: 'refresh_token',
      client_id: 'app.a1.1',
      client_secret: secret,
      refresh_token: refreshToken,
    };
  }

  it('Partner backend renews a token', async () => {
    const { portal, token } = await installed();
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    await install(t.app, other);

    const res = await tokenRequest(t.app, 'POST', catalogRefresh(token.refresh_token));

    expect(res.statusCode).toBe(200);
    const renewed = res.json<TokenResponse & { user_id: number }>();
    expect(renewed).toMatchObject({ user_id: 5, status: 'F' });
    const onA = await rpc<{ scope: string }>(t.app, portal, 'rest.check', {
      TOKEN: renewed.access_token,
    });
    expect(onA.body.result?.scope).toBe('crm,user');
    // A refresh token of portal A never gives tokens for portal B.
    const onB = await rpc(t.app, other, 'rest.check', { TOKEN: renewed.access_token });
    expect(onB.body.error).toBe('invalid_token');
  });

  it('Rotate the secret', async () => {
    const { token } = await installed();
    await addCatalogEntry(t.db, { ...CATALOG_APP, secret: 'rotated-secret-456' });
    t.logs.length = 0;

    const old = await tokenRequest(t.app, 'POST', catalogRefresh(token.refresh_token));
    const fresh = await tokenRequest(
      t.app,
      'POST',
      catalogRefresh(token.refresh_token, 'rotated-secret-456'),
    );

    expect(old.statusCode).toBe(400);
    expect(old.json<{ error: string }>().error).toBe('invalid_client');
    expect(t.logs.find((l) => l.msg === 'request_failed')).toMatchObject({
      reason: 'client_secret_mismatch',
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('Status of a Marketplace application', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);

    const token = await authorize(t.app, portal, 'app.a1.1');
    const checked = await rpc<{ status: string; client_id: string }>(t.app, portal, 'rest.check', {
      TOKEN: token.access_token,
    });

    expect(token.status).toBe('F');
    expect(checked.body.result).toMatchObject({ client_id: 'app.a1.1', status: 'F' });
  });

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
    vi.useFakeTimers({ toFake: ['Date'] });
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
    // The responses are the same; only the log tells the causes apart.
    const reasons = t.logs.filter((l) => l.msg === 'request_failed').map((l) => l.reason);
    expect(reasons).toEqual(
      expect.arrayContaining(['refresh_token_unknown', 'refresh_token_expired']),
    );
  });

  it('A pair pruned before its refresh is marked gets invalid_grant', async () => {
    // refresh() reads the pair, then a parallel issue prunes it before the mark. issuePair sees
    // the same state when it gets the id of a pair that no longer exists.
    await issued();
    const [app] = await t.db.select().from(applications);
    const [portal] = await t.db.select().from(portals);
    const [pair] = await t.db.select().from(tokenPairs);
    await t.db.delete(tokenPairs);

    const issue = issuePair(t.db, TEST_CONFIG, app, portal, {
      scope: pair.scope,
      userId: pair.userId,
      params: pair.params,
      refreshedPairId: pair.id,
    });

    await expect(issue).rejects.toMatchObject({
      code: 'invalid_grant',
      reason: 'refresh_token_pruned',
    });
    expect(await t.db.select().from(tokenPairs)).toEqual([]);
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

  it('Unsupported grant type', async () => {
    const base = { client_id: 'x', client_secret: 'y' };
    const other = await tokenRequest(t.app, 'POST', { ...base, grant_type: 'password' });
    const code = await tokenRequest(t.app, 'POST', {
      ...base,
      grant_type: 'authorization_code',
      code: 'z',
    });

    expect(other.statusCode).toBe(400);
    expect(other.json()).toEqual({
      error: 'invalid_request',
      error_description: 'Invalid grant_type parameter or parameter missing',
    });
    expect(code.statusCode).toBe(400);
    expect(code.json()).toEqual({ error: 'invalid_grant' });
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

// One rest.authorize, then `refreshes` renewals, each with the newest refresh token.
// Returns the refresh token of each pair in issue order.
async function chain(
  app: TestApp,
  portal: Credentials,
  creds: Credentials,
  refreshes: number,
  localUser = '5',
): Promise<string[]> {
  const first = await authorize(app.app, portal, creds.client_id, {
    PARAMS: { LOCAL_USER: localUser },
  });
  const tokens = [first.refresh_token];
  for (let i = 0; i < refreshes; i++) {
    tokens.push(await renew(app, creds, tokens[tokens.length - 1]));
  }
  return tokens;
}

async function renew(app: TestApp, creds: Credentials, refreshToken: string): Promise<string> {
  const res = await tokenRequest(app.app, 'POST', refreshParams(creds, refreshToken));
  if (res.statusCode !== 200) throw new Error(`refresh failed: ${res.body}`);
  return res.json<RefreshResponse>().refresh_token;
}

async function refreshError(creds: Credentials, refreshToken: string): Promise<string | null> {
  const res = await tokenRequest(t.app, 'POST', refreshParams(creds, refreshToken));
  return res.statusCode === 200 ? null : res.json<{ error: string }>().error;
}

async function pairCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of await t.db.select().from(tokenPairs)) {
    const key = `${row.applicationId}:${row.userId}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const HOUR = 3600 * 1000;

describe('Pruning', () => {
  it('Old used pairs are deleted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const tokens = await chain(t, portal, app, 6);

    vi.setSystemTime(Date.now() + HOUR);
    await renew(t, app, tokens[6]);

    // 8 pairs, 7 used with an expired access token: the 2 oldest go.
    expect(await pairCounts()).toEqual({ '1:5': 6 });
    expect(await refreshError(app, tokens[0])).toBe('invalid_grant');
    expect(await refreshError(app, tokens[2])).toBeNull();
  });

  it('Unused pairs are kept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const backend = await authorize(t.app, portal, app.client_id);
    const tokens = await chain(t, portal, app, 10);

    vi.setSystemTime(Date.now() + HOUR);
    await renew(t, app, tokens[10]);

    expect(await refreshError(app, backend.refresh_token)).toBeNull();
  });

  it('A repeat refresh keeps the time of the first use', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const [first] = await chain(t, portal, app, 1);
    const firstUse = Date.now();

    vi.setSystemTime(firstUse + 60_000);
    await renew(t, app, first);

    const rows = await t.db.select().from(tokenPairs);
    const used = rows.filter((row) => row.refreshedAt !== null);
    expect(used.map((row) => row.refreshedAt?.getTime())).toEqual([firstUse]);
  });

  it('Live access tokens are kept', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);

    await chain(t, portal, app, 7);

    expect(await pairCounts()).toEqual({ '1:5': 8 });
  });

  it('Other users and applications are not touched', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const portal = await registerPortal(t.app);
    const appA = await addApp(t.app, portal);
    const appB = await addApp(t.app, portal);
    const tokens = await chain(t, portal, appA, 6, '5');
    await chain(t, portal, appA, 6, '6');
    await chain(t, portal, appB, 6, '5');

    vi.setSystemTime(Date.now() + HOUR);
    await renew(t, appA, tokens[6]);

    // An unscoped DELETE would cut 1:6 and 2:5 too.
    expect(await pairCounts()).toEqual({ '1:5': 6, '1:6': 7, '2:5': 7 });
  });

  describe('when TOKEN_PRUNING=false', () => {
    let off: TestApp;
    beforeAll(async () => {
      off = await startApp({ config: { ...TEST_CONFIG, tokenPruningKeep: null } });
    });
    afterAll(async () => {
      await off.close();
    });

    it('Pruning is off', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const portal = await registerPortal(off.app);
      const app = await addApp(off.app, portal);
      const tokens = await chain(off, portal, app, 6);

      // Same setup as "Old used pairs are deleted", which deletes 2 pairs with pruning on.
      vi.setSystemTime(Date.now() + HOUR);
      await renew(off, app, tokens[6]);

      expect(await pairCounts()).toEqual({ '1:5': 8 });
    });
  });
});

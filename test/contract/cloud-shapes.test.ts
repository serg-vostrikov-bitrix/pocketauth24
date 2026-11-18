import { existsSync, readFileSync } from 'node:fs';
import qs from 'qs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addApp,
  authorize,
  eventItem,
  form,
  registerPortal,
  rpc,
  startApp,
  startHandler,
  TEST_CONFIG,
  tokenRequest,
  truncateAll,
  type TestApp,
} from '../helpers.js';

const CLOUD_HAR = 'test/fixtures/cloud-capture.har';
const HANDLER_HAR = 'test/fixtures/event-handler.har';

// Paths present in the cloud response that we deliberately do not return, with the reason.
const CLOUD_ONLY: Record<string, string> = {};

type HarEntry = {
  request: { method: string; url: string; postData?: { text?: string } };
  response: { status: number; content: { text?: string } };
};
type Captured = { status: number; body: Record<string, unknown> };
type Shape = string | Shape[] | { [key: string]: Shape };

function entries(file: string): HarEntry[] {
  return (JSON.parse(readFileSync(file, 'utf8')) as { log: { entries: HarEntry[] } }).log.entries;
}

function cloud(
  pathPrefix: string,
  pick: (body: Record<string, unknown>) => boolean = () => true,
): Captured {
  for (const entry of entries(CLOUD_HAR)) {
    const text = entry.response.content.text;
    if (!new URL(entry.request.url).pathname.startsWith(pathPrefix) || !text) continue;
    const body = JSON.parse(text) as Record<string, unknown>;
    if (pick(body)) return { status: entry.response.status, body };
  }
  throw new Error(`No captured response for ${pathPrefix}`);
}

function shapeOf(value: unknown, path = ''): Shape {
  if (Array.isArray(value)) return value.length > 0 ? [shapeOf(value[0], `${path}[]`)] : [];
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !(`${path}${key}` in CLOUD_ONLY))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, shapeOf(item, `${path}${key}.`)]),
    );
  }
  return value === null ? 'null' : typeof value;
}

const hasResult = (body: Record<string, unknown>): boolean => 'result' in body;
const hasError = (body: Record<string, unknown>): boolean => 'error' in body;
const errorIs =
  (code: string) =>
  (body: Record<string, unknown>): boolean =>
    body.error === code;

describe.skipIf(!existsSync(CLOUD_HAR))('contract: cloud response shapes', () => {
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

  it('/oauth/register/', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/oauth/register/',
      ...form({ redirect_uri: 'https://portal.test/', type: 'B' }),
    });
    expect(shapeOf(res.json())).toEqual(shapeOf(cloud('/oauth/register/').body));
    expect(res.json<{ host: string }>().host).toBe('portal.test');
  });

  it('application.add', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.add', {
      TITLE: 'Demo',
      REDIRECT_URI: 'https://app.test/',
      SCOPE: 'crm,user',
    });
    expect(shapeOf(res.body.result)).toEqual(
      shapeOf(cloud('/rest/application.add', hasResult).body.result),
    );
  });

  it('rest.authorize', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const res = await rpc(t.app, portal, 'rest.authorize', {
      CLIENT_ID: app.client_id,
      SCOPE: 'crm,user',
      PARAMS: { LOCAL_USER: '1' },
    });
    expect(shapeOf(res.body.result)).toEqual(
      shapeOf(cloud('/rest/rest.authorize', hasResult).body.result),
    );
  });

  it('rest.check valid and invalid', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id, {
      PARAMS: { LOCAL_USER: '1', TZ_OFFSET: '0', EVENT_SESSION: '7' },
    });
    const valid = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });
    const invalid = await rpc(t.app, portal, 'rest.check', { TOKEN: 'garbage' });
    expect(shapeOf(valid.body.result)).toEqual(
      shapeOf(cloud('/rest/rest.check', hasResult).body.result),
    );
    const cloudInvalid = cloud('/rest/rest.check', hasError);
    expect(invalid.status).toBe(cloudInvalid.status);
    expect(invalid.body).toEqual(cloudInvalid.body);
  });

  it('rest.event.call result', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler();
    try {
      const res = await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [eventItem(handler.url)],
      });
      expect(res.body.result).toBe(cloud('/rest/rest.event.call', hasResult).body.result);
    } finally {
      await handler.close();
    }
  });

  it('/oauth/token/ refresh, invalid grant, invalid client and unsupported grants', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const token = await authorize(t.app, portal, app.client_id);
    const base = { client_id: app.client_id, client_secret: app.client_secret };
    const refreshWith = (over: Record<string, string>): ReturnType<typeof tokenRequest> =>
      tokenRequest(t.app, 'GET', {
        ...base,
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
        ...over,
      });
    const renewed = await refreshWith({});
    const badGrant = await refreshWith({ refresh_token: 'garbage' });
    const badClient = await refreshWith({ client_secret: 'wrong' });
    const codeGrant = await tokenRequest(t.app, 'GET', {
      ...base,
      grant_type: 'authorization_code',
    });
    const otherGrant = await tokenRequest(t.app, 'GET', { ...base, grant_type: 'password' });

    const cloudRenewed = cloud('/oauth/token/', (b) => 'access_token' in b);
    expect(renewed.statusCode).toBe(cloudRenewed.status);
    expect(shapeOf(renewed.json())).toEqual(shapeOf(cloudRenewed.body));
    expect(renewed.json()).toMatchObject({
      scope: cloudRenewed.body.scope,
      domain: new URL(TEST_CONFIG.baseUrl).host,
    });
    expect(cloudRenewed.body.domain).toBe(
      new URL(
        entries(CLOUD_HAR).find((e) => e.request.url.includes('/oauth/token/'))?.request.url ?? '',
      ).host,
    );

    const errors: [Awaited<ReturnType<typeof tokenRequest>>, Captured][] = [
      [badGrant, cloud('/oauth/token/', errorIs('invalid_grant'))],
      [badClient, cloud('/oauth/token/', errorIs('invalid_client'))],
      [codeGrant, cloud('/oauth/token/', errorIs('invalid_grant'))],
      [otherGrant, cloud('/oauth/token/', errorIs('invalid_request'))],
    ];
    for (const [ours, theirs] of errors) {
      expect(ours.statusCode).toBe(theirs.status);
      expect(ours.json()).toEqual(theirs.body);
    }
  });

  it.skipIf(!existsSync(HANDLER_HAR))('event POST body', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    try {
      // Same input as the captured ONAPPINSTALL: LOCAL_USER=0, so the cloud sent no tokens.
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            client_id: app.client_id,
            event: 'ONAPPINSTALL',
            auth: {
              LOCAL_USER: '0',
              application_token: 'x',
              domain: 'localhost',
              member_id: 'x',
            },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
        ],
      });
      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(1);
      });
      const captured = entries(HANDLER_HAR).find((e) => e.request.method === 'POST');
      const cloudBody = qs.parse(captured?.request.postData?.text ?? '', { depth: 20 });
      // Compare top-level keys and auth keys only; event data differs by event.
      expect(Object.keys(handler.requests[0]).sort()).toEqual(Object.keys(cloudBody).sort());
      expect(shapeOf(handler.requests[0].auth)).toEqual(shapeOf(cloudBody.auth));
    } finally {
      await handler.close();
    }
  });
});

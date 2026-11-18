import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addApp,
  eventItem,
  md5,
  PORTAL,
  registerPortal,
  rpc,
  startApp,
  startHandler,
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
  t.logs.length = 0;
});

describe('event-delivery', () => {
  it('Portal hands over events', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ hold: true });
    try {
      const res = await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [eventItem(handler.url, { event: 'ONE' }), eventItem(handler.url, { event: 'TWO' })],
      });

      // The handler holds both responses, so result: true proves we did not wait for delivery.
      expect(res.body).toEqual({ result: true });
      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(2);
      });
      expect(handler.requests.map((r) => r.event).sort()).toEqual(['ONE', 'TWO']);
    } finally {
      await handler.close();
    }
  });

  it('Event without user auth', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            auth: { LOCAL_USER: '1', application_token: 'apptoken123' },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
          eventItem(handler.url, {
            client_id: app.client_id,
            auth: { LOCAL_USER: '0', application_token: 'apptoken123' },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(2);
      });
      for (const request of handler.requests) {
        expect(request).toEqual({
          event: 'ONCRMDEALADD',
          event_handler_id: '7',
          data: { FIELDS: { ID: '42' } },
          ts: '1763460000',
          auth: {
            domain: 'portal.test',
            member_id: md5(portal.client_id),
            application_token: 'apptoken123',
          },
        });
      }
    } finally {
      await handler.close();
    }
  });

  it('Install event reaches a server-side app', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    const userAuth = { LOCAL_USER: '1', application_token: 'apptoken123' };
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            client_id: app.client_id,
            event: 'ONAPPINSTALL',
            auth: userAuth,
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
          eventItem(handler.url, {
            client_id: app.client_id,
            event: 'ONCRMDEALADD',
            auth: userAuth,
            additional: { sendAuth: '1', sendRefreshToken: '0' },
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(2);
      });
      const byEvent = Object.fromEntries(
        handler.requests.map((r) => [String(r.event), r.auth as Record<string, unknown>]),
      );
      const install = byEvent.ONAPPINSTALL;
      expect(install).toMatchObject({
        domain: 'portal.test',
        member_id: md5(portal.client_id),
        application_token: 'apptoken123',
        user_id: '1',
        scope: 'crm,user',
        status: 'L',
      });
      expect(install.access_token).toMatch(/^[0-9a-f]{64}$/);
      expect(install.refresh_token).toMatch(/^[0-9a-f]{64}$/);
      expect(byEvent.ONCRMDEALADD.access_token).toMatch(/^[0-9a-f]{64}$/);
      expect(byEvent.ONCRMDEALADD).not.toHaveProperty('refresh_token');

      const checked = await rpc(t.app, portal, 'rest.check', {
        TOKEN: String(install.access_token),
      });
      expect(checked.body.result).toMatchObject({ client_id: app.client_id, user_id: 1 });
    } finally {
      await handler.close();
    }
  });

  it('Handler is down', async () => {
    const portal = await registerPortal(t.app);
    const app = await addApp(t.app, portal);
    const handler = await startHandler();
    const url = handler.url;
    await handler.close(); // connections to this port are now refused

    await rpc(t.app, portal, 'rest.event.call', {
      QUERY: [eventItem(url, { client_id: app.client_id })],
    });

    const failures = (): typeof t.logs => t.logs.filter((l) => l.msg === 'event_delivery_failed');
    await vi.waitFor(() => {
      expect(failures()).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      portal: PORTAL,
      client_id: app.client_id,
      event: 'ONCRMDEALADD',
      url,
    });
  });

  it('Nested data deeper than 5 levels arrives intact', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler();
    const deep = { a: { b: { c: { d: { e: { f: { g: 'leaf' } } } } } } };
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [eventItem(handler.url, { data: deep })],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(1);
      });
      expect(handler.requests[0].data).toEqual(deep);
    } finally {
      await handler.close();
    }
  });

  it('Overload', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ hold: true });
    try {
      const items = Array.from({ length: 201 }, (_, i) =>
        eventItem(handler.url, { event: `E${i}` }),
      );

      const res = await rpc(t.app, portal, 'rest.event.call', { QUERY: items });

      expect(res.body).toEqual({ result: true });
      await vi.waitFor(
        () => {
          expect(handler.requests).toHaveLength(200);
        },
        { timeout: 5000 },
      );
      const dropped = t.logs.filter((l) => l.msg === 'event_dropped_overload');
      expect(dropped).toHaveLength(1);
      expect(dropped[0]).toMatchObject({ event: 'E200', url: handler.url });
    } finally {
      await handler.close();
    }
  });

  it('Failed delivery does not log handler credentials', async () => {
    const portal = await registerPortal(t.app);
    const closed = await startHandler();
    const closedUrl = new URL(closed.url);
    await closed.close();

    await rpc(t.app, portal, 'rest.event.call', {
      QUERY: [
        eventItem(`http://user:pass@127.0.0.1:${closedUrl.port}/hook?token=SECRET`),
        eventItem('not a url'),
      ],
    });
    await vi.waitFor(() => {
      expect(t.logs.filter((l) => l.msg === 'event_delivery_failed')).toHaveLength(2);
    });

    const text = JSON.stringify(t.logs);
    expect(text).not.toContain('user:pass');
    expect(text).not.toContain('SECRET');
    expect(text).toContain(`http://127.0.0.1:${closedUrl.port}/hook`);
    expect(text).toContain('<invalid url>');
  });
});

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
});

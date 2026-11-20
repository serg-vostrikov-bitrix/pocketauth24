import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_HOST_IN_FLIGHT_CAP, EVENT_IN_FLIGHT_CAP } from '../../src/config.js';
import {
  addApp,
  addCatalogEntry,
  eventItem,
  install,
  md5,
  PORTAL,
  registerPortal,
  rpc,
  startApp,
  startHandler,
  truncateAll,
  type TestApp,
} from '../helpers.js';
import { eventCounters, tokenPairs } from '../../src/schema.js';
import { sha256 } from '../../src/tokens.js';
import { eq } from 'drizzle-orm';
import { utcDay } from '../../src/eventCounters.js';

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

async function counterRows(): Promise<{ day: string; outcome: string; count: number }[]> {
  return t.db
    .select({ day: eventCounters.day, outcome: eventCounters.outcome, count: eventCounters.count })
    .from(eventCounters);
}

describe('event-delivery', () => {
  it('Install event reaches a Marketplace install', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);
    const handler = await startHandler();
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            client_id: 'app.a1.1',
            event: 'ONAPPINSTALL',
            auth: { LOCAL_USER: '1', application_token: 'apptoken123' },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(1);
      });
      const auth = handler.requests[0].auth as Record<string, unknown>;
      expect(auth).toMatchObject({
        domain: 'portal.test',
        server_endpoint: 'https://auth.test/rest/',
        member_id: md5(portal.client_id),
        user_id: '1',
        scope: 'crm,user',
        status: 'F',
      });
      expect(auth.access_token).toMatch(/^[0-9a-f]{64}$/);
      expect(auth.refresh_token).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await handler.close();
    }
  });

  it.each([
    { status: 200, outcome: 'delivered' },
    { status: 500, outcome: 'failed' },
  ] as const)('Handler responds $status: $outcome counter +1', async ({ status, outcome }) => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ status });
    try {
      await rpc(t.app, portal, 'rest.event.call', { QUERY: [eventItem(handler.url)] });
      await vi.waitFor(async () => {
        expect(await counterRows()).toEqual([{ day: utcDay(new Date()), outcome, count: 1 }]);
      });
    } finally {
      await handler.close();
    }
  });

  it('Portal hands over events', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ hold: true });
    try {
      const res = await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [eventItem(handler.url, { event: 'ONE' }), eventItem(handler.url, { event: 'TWO' })],
      });

      // The handler holds both responses, so result: null proves we did not wait for delivery.
      expect(res.body).toEqual({ result: null });
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
            client_endpoint: 'https://portal.test/rest/',
            server_endpoint: 'https://auth.test/rest/',
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
      expect(checked.body.result).toMatchObject({
        client_id: app.client_id,
        parameters: { LOCAL_USER: 1 },
      });

      // Nobody holds the refresh token of the second pair, so it is "used" from the start and
      // pruning can delete it. The first pair is unused: its handler keeps the refresh token.
      const refreshedAt = async (accessToken: unknown) => {
        const [pair] = await t.db
          .select({ refreshedAt: tokenPairs.refreshedAt })
          .from(tokenPairs)
          .where(eq(tokenPairs.accessHash, sha256(String(accessToken))));
        return pair.refreshedAt;
      };
      expect(await refreshedAt(install.access_token)).toBeNull();
      expect(await refreshedAt(byEvent.ONCRMDEALADD.access_token)).toBeInstanceOf(Date);
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
    // Spread the load so that no host reaches its own cap before the global cap.
    const perHost = 40;
    const handlers = await Promise.all(
      Array.from({ length: EVENT_IN_FLIGHT_CAP / perHost + 1 }, () => startHandler({ hold: true })),
    );
    try {
      const items = Array.from({ length: EVENT_IN_FLIGHT_CAP + 1 }, (_, i) =>
        eventItem(handlers[Math.floor(i / perHost)].url, { event: `E${i}` }),
      );

      const res = await rpc(t.app, portal, 'rest.event.call', { QUERY: items });

      expect(res.body).toEqual({ result: null });
      const received = (): number => handlers.reduce((n, h) => n + h.requests.length, 0);
      await vi.waitFor(
        () => {
          expect(received()).toBe(EVENT_IN_FLIGHT_CAP);
        },
        { timeout: 5000 },
      );
      const dropped = t.logs.filter((l) => l.msg === 'event_dropped_overload');
      expect(dropped).toHaveLength(1);
      expect(dropped[0]).toMatchObject({
        event: `E${EVENT_IN_FLIGHT_CAP}`,
        url: handlers.at(-1)?.url,
        limit: 'global',
      });
      await vi.waitFor(async () => {
        expect((await counterRows()).find((r) => r.outcome === 'dropped')?.count).toBe(1);
      });
    } finally {
      await Promise.all(handlers.map((h) => h.close()));
    }
  });

  it('Slow handler does not block other handlers', async () => {
    const portal = await registerPortal(t.app);
    const slow = await startHandler({ hold: true });
    const other = await startHandler();
    try {
      const slowItems = Array.from({ length: EVENT_HOST_IN_FLIGHT_CAP + 1 }, (_, i) =>
        eventItem(slow.url, { event: `S${i}` }),
      );
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [...slowItems, eventItem(other.url, { event: 'OTHER' })],
      });

      await vi.waitFor(
        () => {
          expect(slow.requests).toHaveLength(EVENT_HOST_IN_FLIGHT_CAP);
          expect(other.requests).toHaveLength(1);
        },
        { timeout: 5000 },
      );
      const dropped = t.logs.filter((l) => l.msg === 'event_dropped_overload');
      expect(dropped).toHaveLength(1);
      expect(dropped[0]).toMatchObject({
        event: `S${EVENT_HOST_IN_FLIGHT_CAP}`,
        url: slow.url,
        limit: 'host',
      });

      // When the slow handler answers, its host gets its slots back.
      slow.release();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [eventItem(slow.url, { event: 'AFTER' })],
      });
      await vi.waitFor(() => {
        expect(slow.requests.map((r) => r.event)).toContain('AFTER');
      });
    } finally {
      await Promise.all([slow.close(), other.close()]);
    }
  });

  it('Overload drops of one batch are counted with one write', async () => {
    const portal = await registerPortal(t.app);
    // Spread the load so that no host reaches its own cap before the global cap.
    const perHost = 40;
    const handlers = await Promise.all(
      Array.from({ length: EVENT_IN_FLIGHT_CAP / perHost + 1 }, () => startHandler({ hold: true })),
    );
    const insert = vi.spyOn(t.db, 'insert');
    try {
      const items = Array.from({ length: EVENT_IN_FLIGHT_CAP + 5 }, (_, i) =>
        eventItem(handlers[Math.floor(i / perHost)].url),
      );

      await rpc(t.app, portal, 'rest.event.call', { QUERY: items });

      const received = (): number => handlers.reduce((n, h) => n + h.requests.length, 0);
      await vi.waitFor(
        () => {
          expect(received()).toBe(EVENT_IN_FLIGHT_CAP);
        },
        { timeout: 5000 },
      );
      await vi.waitFor(async () => {
        expect((await counterRows()).find((r) => r.outcome === 'dropped')?.count).toBe(5);
      });
      expect(insert.mock.calls.filter(([table]) => table === eventCounters)).toHaveLength(1);
      expect(t.logs.filter((l) => l.msg === 'event_dropped_overload')).toHaveLength(5);
    } finally {
      insert.mockRestore();
      await Promise.all(handlers.map((h) => h.close()));
    }
  });

  it('Host-cap drops of one batch are counted as dropped with one write', async () => {
    const portal = await registerPortal(t.app);
    const handler = await startHandler({ hold: true });
    const insert = vi.spyOn(t.db, 'insert');
    try {
      const items = Array.from({ length: EVENT_HOST_IN_FLIGHT_CAP + 5 }, () =>
        eventItem(handler.url),
      );

      await rpc(t.app, portal, 'rest.event.call', { QUERY: items });

      await vi.waitFor(
        () => {
          expect(handler.requests).toHaveLength(EVENT_HOST_IN_FLIGHT_CAP);
        },
        { timeout: 5000 },
      );
      await vi.waitFor(async () => {
        expect((await counterRows()).find((r) => r.outcome === 'dropped')?.count).toBe(5);
      });
      expect(insert.mock.calls.filter(([table]) => table === eventCounters)).toHaveLength(1);
      const dropped = t.logs.filter((l) => l.msg === 'event_dropped_overload');
      expect(dropped).toHaveLength(5);
      expect(dropped.every((l) => l.limit === 'host')).toBe(true);
    } finally {
      insert.mockRestore();
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

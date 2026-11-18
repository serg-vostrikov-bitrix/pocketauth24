import { and, eq } from 'drizzle-orm';
import qs from 'qs';
import { defineMethod, type MethodContext } from '../bitrix.js';
import { EVENT_IN_FLIGHT_CAP, EVENT_TIMEOUT_MS } from '../config.js';
import { applications } from '../schema.js';
import { issuePair, localUserId, memberId, portalDomain } from '../tokens.js';

export type EventItem = {
  client_id?: string;
  auth?: Record<string, unknown>;
  query: { QUERY_URL: string; QUERY_DATA?: Record<string, unknown> };
  additional?: Record<string, unknown>;
};

type EventCallBody = { QUERY: EventItem[] };

const eventCallSchema = {
  type: 'object',
  required: ['QUERY'],
  properties: {
    QUERY: {
      type: 'array',
      items: {
        type: 'object',
        required: ['query'],
        properties: {
          client_id: { type: 'string' },
          auth: { type: 'object' },
          additional: { type: 'object' },
          query: {
            type: 'object',
            required: ['QUERY_URL'],
            properties: { QUERY_URL: { type: 'string' }, QUERY_DATA: { type: 'object' } },
          },
        },
      },
    },
  },
} as const;

async function buildAuth(ctx: MethodContext, item: EventItem): Promise<Record<string, unknown>> {
  const applicationToken = item.auth?.application_token ?? '';
  const base = {
    domain: portalDomain(ctx.portal),
    client_endpoint: `${ctx.portal.origin}/rest/`,
    server_endpoint: `${ctx.config.baseUrl}/rest/`,
    member_id: memberId(ctx.portal),
    application_token: applicationToken,
  };
  const localUser = localUserId(item.auth?.LOCAL_USER);
  const additional = item.additional ?? {};
  // PHP http_build_query sends booleans as "1" / "0".
  if (!item.client_id || localUser === 0 || additional.sendAuth !== '1') return base;
  const [app] = await ctx.db
    .select()
    .from(applications)
    .where(and(eq(applications.clientId, item.client_id), eq(applications.portalId, ctx.portal.id)))
    .limit(1);
  if (!app) return base;
  const { refresh_token, ...tokens } = await issuePair(ctx.db, ctx.config, app, ctx.portal, {
    scope: app.scope,
    userId: localUser,
    params: item.auth ?? {},
  });
  return {
    ...tokens,
    user_id: localUser,
    ...(additional.sendRefreshToken === '1' ? { refresh_token } : {}),
    application_token: applicationToken,
  };
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

// Handler URLs may carry credentials (userinfo, query); log origin and path only.
function safeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin + url.pathname;
  } catch {
    return '<invalid url>';
  }
}

// One attempt, no retries; nothing survives a restart (stage 3 adds a persistent queue).
export async function deliver(ctx: MethodContext, item: EventItem): Promise<void> {
  const data = item.query.QUERY_DATA ?? {};
  const fields = {
    portal: ctx.portal.origin,
    client_id: item.client_id ?? null,
    event: data.event ?? null,
    url: safeUrl(item.query.QUERY_URL),
  };
  if (ctx.delivery.inFlight >= EVENT_IN_FLIGHT_CAP) {
    // ponytail: in-memory cap, persistent queue in stage 3
    ctx.log.warn(fields, 'event_dropped_overload');
    return;
  }
  ctx.delivery.inFlight++;
  try {
    const auth = await buildAuth(ctx, item);
    const body = qs.stringify({
      event: data.event,
      event_handler_id: data.event_handler_id,
      data: data.data,
      ts: data.ts,
      auth,
    });
    const response = await fetch(item.query.QUERY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(EVENT_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (!response.ok) ctx.log.warn({ ...fields, status: response.status }, 'event_delivery_failed');
  } catch (error) {
    ctx.log.warn(
      { ...fields, error: errorText(error).replaceAll(item.query.QUERY_URL, fields.url) },
      'event_delivery_failed',
    );
  } finally {
    ctx.delivery.inFlight--;
  }
}

export const restEventCall = defineMethod<EventCallBody>(eventCallSchema, async (ctx, body) => {
  for (const item of body.QUERY) void deliver(ctx, item);
  return null; // the cloud answers {"result":null}
});

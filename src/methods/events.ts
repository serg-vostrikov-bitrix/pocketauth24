import qs from 'qs';
import { defineMethod, type MethodContext } from '../bitrix.js';
import { EVENT_IN_FLIGHT_CAP, EVENT_TIMEOUT_MS } from '../config.js';
import { memberId, portalDomain } from '../tokens.js';

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

function buildAuth(ctx: MethodContext, item: EventItem): Record<string, unknown> {
  return {
    domain: portalDomain(ctx.portal),
    member_id: memberId(ctx.portal),
    application_token: item.auth?.application_token ?? '',
  };
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

// One attempt, no retries; nothing survives a restart (stage 3 adds a persistent queue).
export async function deliver(ctx: MethodContext, item: EventItem): Promise<void> {
  const data = item.query.QUERY_DATA ?? {};
  const fields = {
    portal: ctx.portal.origin,
    client_id: item.client_id ?? null,
    event: data.event ?? null,
    url: item.query.QUERY_URL,
  };
  if (ctx.delivery.inFlight >= EVENT_IN_FLIGHT_CAP) {
    // ponytail: in-memory cap, persistent queue in stage 3
    ctx.log.warn(fields, 'event_dropped_overload');
    return;
  }
  ctx.delivery.inFlight++;
  try {
    const auth = buildAuth(ctx, item);
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
    ctx.log.warn({ ...fields, error: errorText(error) }, 'event_delivery_failed');
  } finally {
    ctx.delivery.inFlight--;
  }
}

export const restEventCall = defineMethod<EventCallBody>(eventCallSchema, async (ctx, body) => {
  for (const item of body.QUERY) void deliver(ctx, item);
  return true;
});

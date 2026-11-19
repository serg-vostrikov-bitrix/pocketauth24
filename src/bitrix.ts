import type { FastifyBaseLogger, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Portal } from './schema.js';

// `reason` goes to the log only. Use it when one client-visible code has several causes.
export class BitrixError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
    readonly status = 400,
    readonly reason?: string,
  ) {
    super(`${code}: ${description}`);
  }
}

export function fail(code: string, description: string, status = 400, reason?: string): never {
  throw new BitrixError(code, description, status, reason);
}

const rejectReasons = new WeakMap<FastifyRequest, string>();

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null && key in body
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

// onSend hook: one `request_failed` line for every error response, also for replies that do not
// go through sendError. It logs selected fields only, because a body can carry other data.
export async function logErrorResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (reply.statusCode < 400) return payload;
  let body: unknown;
  try {
    body = typeof payload === 'string' ? JSON.parse(payload) : undefined;
  } catch {
    body = undefined;
  }
  const level = reply.statusCode >= 500 ? 'warn' : 'info';
  request.log[level](
    {
      status: reply.statusCode,
      error: field(body, 'error') ?? null,
      error_description: field(body, 'error_description') ?? null,
      column: field(body, 'column'),
      reason: rejectReasons.get(request),
    },
    'request_failed',
  );
  return payload;
}

export function ok<T>(result: T): { result: T } {
  return { result };
}

export function sendError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof BitrixError) {
    if (error.reason) rejectReasons.set(request, error.reason);
    // The cloud's /oauth/token/ errors carry no description; an empty one is left out.
    return reply
      .status(error.status)
      .send(
        error.description
          ? { error: error.code, error_description: error.description }
          : { error: error.code },
      );
  }
  if (error.validation || (error.statusCode !== undefined && error.statusCode < 500)) {
    return reply
      .status(error.statusCode ?? 400)
      .send({ error: 'invalid_request', error_description: error.message });
  }
  request.log.error({ err: error }, 'unhandled_error');
  return reply.status(500).send({ error: 'internal_error' });
}

// inFlight counts all deliveries; byHost counts them per handler host (host:port).
export type DeliveryState = { inFlight: number; byHost: Map<string, number> };

export type MethodContext = {
  portal: Portal;
  db: Db;
  config: Config;
  log: FastifyBaseLogger;
  delivery: DeliveryState;
};

export type Method = {
  schema: object;
  handler: (ctx: MethodContext, body: unknown) => Promise<unknown>;
};

// The body is validated against `schema` by Fastify before the handler runs.
export function defineMethod<B>(
  schema: object,
  handler: (ctx: MethodContext, body: B) => Promise<unknown>,
): Method {
  return { schema, handler: (ctx, body) => handler(ctx, body as B) };
}

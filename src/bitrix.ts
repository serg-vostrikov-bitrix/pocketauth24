import type { FastifyBaseLogger, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Portal } from './schema.js';

export class BitrixError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(`${code}: ${description}`);
  }
}

export function fail(code: string, description: string, status = 400): never {
  throw new BitrixError(code, description, status);
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
    return reply
      .status(error.status)
      .send({ error: error.code, error_description: error.description });
  }
  if (error.validation || (error.statusCode !== undefined && error.statusCode < 500)) {
    return reply
      .status(error.statusCode ?? 400)
      .send({ error: 'invalid_request', error_description: error.message });
  }
  request.log.error({ err: error }, 'unhandled_error');
  return reply.status(500).send({ error: 'internal_error' });
}

export type DeliveryState = { inFlight: number };

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

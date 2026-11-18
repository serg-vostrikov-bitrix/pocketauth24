import type { Writable } from 'node:stream';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import qs from 'qs';
import { BODY_LIMIT_BYTES, LOG_LEVEL, QS_OPTIONS, type Config } from './config.js';

export type AppDeps = { config: Config; logStream?: Writable };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: deps.logStream ? { level: LOG_LEVEL, stream: deps.logStream } : { level: LOG_LEVEL },
  });
  await app.register(formbody, { parser: (body) => qs.parse(body, QS_OPTIONS) });
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}

import type { Writable } from 'node:stream';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import qs from 'qs';
import { sendError } from './bitrix.js';
import { BODY_LIMIT_BYTES, LOG_LEVEL, QS_OPTIONS, type Config } from './config.js';
import type { Db } from './db.js';
import { oauthTokenRoute } from './routes/oauthToken.js';
import { registerRoute } from './routes/register.js';
import { rpcRoute } from './routes/rpc.js';

export type AppDeps = { config: Config; db: Db; logStream?: Writable };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    logger: deps.logStream ? { level: LOG_LEVEL, stream: deps.logStream } : { level: LOG_LEVEL },
  });
  await app.register(formbody, { parser: (body) => qs.parse(body, QS_OPTIONS) });
  app.setErrorHandler(sendError);
  app.get('/health', async () => ({ status: 'ok' }));
  registerRoute(app, deps);
  rpcRoute(app, deps);
  oauthTokenRoute(app, deps);
  return app;
}

import type { Writable } from 'node:stream';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import qs from 'qs';
import { registerAdmin } from './admin/index.js';
import { sendError } from './bitrix.js';
import { BODY_LIMIT_BYTES, LOG_LEVEL, QS_OPTIONS, type Config } from './config.js';
import type { Db } from './db.js';
import { oauthTokenRoute } from './routes/oauthToken.js';
import { registerRoute } from './routes/register.js';
import { rpcRoute } from './routes/rpc.js';
import { createStatusService, probeDatabase, VERSION } from './status.js';
import { registerWeb } from './static.js';

export type AppDeps = { config: Config; db: Db; logStream?: Writable; webRoot?: string };

// Query strings carry secrets (client_secret, refresh_token, auth); never log them.
const logOptions = {
  level: LOG_LEVEL,
  serializers: {
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: request.url.split('?')[0],
      hostname: request.hostname,
      remoteAddress: request.ip,
    }),
  },
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    routerOptions: { ignoreTrailingSlash: true },
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: deps.config.trustProxy,
    logger: deps.logStream ? { ...logOptions, stream: deps.logStream } : logOptions,
  });
  await app.register(formbody, { parser: (body) => qs.parse(body, QS_OPTIONS) });
  app.setErrorHandler(sendError);
  app.setNotFoundHandler(async (_request, reply) =>
    reply.status(404).send({ error: 'not_found', error_description: 'Not found' }),
  );
  app.get('/health', async (_request, reply) =>
    (await probeDatabase(deps.db))
      ? { status: 'ok' }
      : reply.status(503).send({ status: 'error', database: 'down' }),
  );

  const statusService = createStatusService({ db: deps.db, version: VERSION, log: app.log });
  app.get('/api/status', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return statusService.get();
  });
  registerRoute(app, deps);
  rpcRoute(app, deps);
  oauthTokenRoute(app, deps);
  await registerAdmin(app, deps);
  if (deps.webRoot) await registerWeb(app, deps.webRoot);
  return app;
}

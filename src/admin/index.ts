import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { jsonGuard, loginRoute, sessionGuard, sessionRoutes } from './auth.js';

export async function registerAdmin(app: FastifyInstance, deps: { db: Db }): Promise<void> {
  await app.register(
    async (admin) => {
      await admin.register(cookie);
      admin.decorateRequest('adminUser', null);
      admin.addHook('onRequest', jsonGuard);
      admin.addHook('onSend', async (_request, reply, payload) => {
        reply.header('cache-control', 'no-store');
        return payload;
      });
      admin.setNotFoundHandler(async (_request, reply) =>
        reply.status(404).send({ error: 'not_found' }),
      );
      loginRoute(admin, deps.db);
      // Every route in this scope needs a valid session. The check runs at onRequest, before
      // body parsing and validation; the cookie plugin's own onRequest hook runs first.
      await admin.register(async (authed) => {
        authed.addHook('onRequest', sessionGuard(deps.db));
        sessionRoutes(authed, deps.db);
      });
    },
    { prefix: '/api/admin' },
  );
}

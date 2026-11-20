import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.js';
import { fail, ok, type DeliveryState, type Method } from '../bitrix.js';
import {
  applicationAdd,
  applicationDelete,
  applicationInstall,
  applicationInstallSubscription,
  applicationList,
  applicationUpdate,
} from '../methods/applications.js';
import { restEventCall } from '../methods/events.js';
import { restAuthorize, restCheck } from '../methods/tokens.js';
import { portals, type Portal } from '../schema.js';
import { hashMatches } from '../tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    portal: Portal | null;
  }
}

export const methods: Record<string, Method> = {
  'application.add': applicationAdd,
  'application.list': applicationList,
  'application.update': applicationUpdate,
  'application.delete': applicationDelete,
  'application.install': applicationInstall,
  'application.install.subscription': applicationInstallSubscription,
  'rest.authorize': restAuthorize,
  'rest.check': restCheck,
  'rest.event.call': restEventCall,
};

export function rpcRoute(app: FastifyInstance, deps: AppDeps): void {
  const delivery: DeliveryState = { inFlight: 0, byHost: new Map() };
  app.decorateRequest('portal', null);

  // preValidation: credentials are checked before the body schema, so a bad caller
  // always gets invalid_client and nothing else runs.
  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const clientId = typeof body.client_id === 'string' ? body.client_id : '';
    const secret = typeof body.client_secret === 'string' ? body.client_secret : '';
    const [portal] = await deps.db
      .select()
      .from(portals)
      .where(eq(portals.clientId, clientId))
      .limit(1);
    if (!portal) fail('invalid_client', 'Invalid client credentials', 401, 'client_id_unknown');
    if (!hashMatches(portal.secretHash, secret)) {
      fail('invalid_client', 'Invalid client credentials', 401, 'client_secret_mismatch');
    }
    request.portal = portal;
  };

  for (const [name, method] of Object.entries(methods)) {
    app.post(
      `/rest/${name}`,
      { preValidation: authenticate, schema: { body: method.schema } },
      async (request) => {
        const portal = request.portal;
        if (!portal) fail('invalid_client', 'Invalid client credentials', 401);
        const ctx = { portal, db: deps.db, config: deps.config, log: request.log, delivery };
        return ok(await method.handler(ctx, request.body));
      },
    );
  }

  app.post('/rest/:method', { preValidation: authenticate }, async () =>
    fail('ERROR_METHOD_NOT_FOUND', 'Method not found'),
  );
}

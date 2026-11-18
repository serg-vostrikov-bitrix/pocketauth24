import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { fail } from '../bitrix.js';
import { portals } from '../schema.js';
import { randomHex, sha256 } from '../tokens.js';

type RegisterBody = { redirect_uri: string };

const registerSchema = {
  type: 'object',
  required: ['redirect_uri'],
  properties: { redirect_uri: { type: 'string' } },
} as const;

export function registerRoute(app: FastifyInstance, deps: AppDeps): void {
  app.post<{ Body: RegisterBody }>(
    '/oauth/register/',
    { schema: { body: registerSchema } },
    async (request) => {
      let url: URL;
      try {
        url = new URL(request.body.redirect_uri);
      } catch {
        fail('invalid_request', 'redirect_uri is not a valid URL');
      }
      if (!deps.config.portalAllowlist.includes(url.host.toLowerCase())) {
        fail('access_denied', 'Portal is not allowed to register on this server');
      }
      const origin = url.origin.toLowerCase();
      const clientId = randomHex(16);
      const clientSecret = randomHex(32);
      const secretHash = sha256(clientSecret);
      // Licence fields (BX_*) are ignored in this stage.
      await deps.db
        .insert(portals)
        .values({ origin, clientId, secretHash })
        .onConflictDoUpdate({ target: portals.origin, set: { clientId, secretHash } });
      return { client_id: clientId, client_secret: clientSecret, host: url.hostname };
    },
  );
}

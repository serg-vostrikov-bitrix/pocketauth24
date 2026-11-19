import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { fail } from '../bitrix.js';
import { refresh, type RefreshResponse } from '../tokens.js';

type TokenParams = {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
};

const tokenParamsSchema = {
  type: 'object',
  properties: {
    grant_type: { type: 'string' },
    client_id: { type: 'string' },
    client_secret: { type: 'string' },
    refresh_token: { type: 'string' },
  },
} as const;

export function oauthTokenRoute(app: FastifyInstance, deps: AppDeps): void {
  const handle = async (params: TokenParams): Promise<RefreshResponse> => {
    if (params.grant_type === 'authorization_code') {
      fail('invalid_grant', '', 400, 'authorization_code_not_supported');
    }
    if (params.grant_type !== 'refresh_token') {
      fail('invalid_request', 'Invalid grant_type parameter or parameter missing');
    }
    if (!params.client_id || !params.client_secret || !params.refresh_token) {
      fail('invalid_request', 'client_id, client_secret and refresh_token are required');
    }
    return refresh(deps.db, deps.config, {
      clientId: params.client_id,
      clientSecret: params.client_secret,
      refreshToken: params.refresh_token,
    });
  };

  app.get<{ Querystring: TokenParams }>(
    '/oauth/token/',
    { schema: { querystring: tokenParamsSchema } },
    async (request) => handle(request.query),
  );
  app.post<{ Body: TokenParams }>(
    '/oauth/token/',
    { schema: { body: tokenParamsSchema } },
    async (request) => handle(request.body),
  );
}

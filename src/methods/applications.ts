import { randomInt } from 'node:crypto';
import { defineMethod } from '../bitrix.js';
import { applications } from '../schema.js';
import { normalizeScope, randomHex, sha256 } from '../tokens.js';

export const scopeSchema = {
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
} as const;

type AddBody = { TITLE: string; REDIRECT_URI: string; SCOPE?: string | string[] };

const addSchema = {
  type: 'object',
  required: ['TITLE'],
  properties: {
    TITLE: { type: 'string' },
    REDIRECT_URI: { type: 'string', default: '' },
    SCOPE: scopeSchema,
  },
} as const;

function localClientId(): string {
  return `local.${randomHex(7)}.${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

export const applicationAdd = defineMethod<AddBody>(addSchema, async (ctx, body) => {
  const clientId = localClientId();
  const clientSecret = randomHex(32);
  await ctx.db.insert(applications).values({
    portalId: ctx.portal.id,
    clientId,
    secretHash: sha256(clientSecret),
    title: body.TITLE,
    redirectUri: body.REDIRECT_URI,
    scope: normalizeScope(body.SCOPE),
  });
  return { client_id: clientId, client_secret: clientSecret };
});

export const applicationList = defineMethod<Record<string, unknown>>(
  { type: 'object' },
  async () => [],
);

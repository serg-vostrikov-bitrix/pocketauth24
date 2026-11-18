import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { defineMethod, fail } from '../bitrix.js';
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

type UpdateBody = {
  CLIENT_ID: string;
  TITLE?: string;
  REDIRECT_URI?: string;
  SCOPE?: string | string[];
};

const updateSchema = {
  type: 'object',
  required: ['CLIENT_ID'],
  properties: {
    CLIENT_ID: { type: 'string' },
    TITLE: { type: 'string' },
    REDIRECT_URI: { type: 'string' },
    SCOPE: scopeSchema,
  },
} as const;

type DeleteBody = { CLIENT_ID: string };

const deleteSchema = {
  type: 'object',
  required: ['CLIENT_ID'],
  properties: { CLIENT_ID: { type: 'string' } },
} as const;

export const applicationUpdate = defineMethod<UpdateBody>(updateSchema, async (ctx, body) => {
  const updated = await ctx.db
    .update(applications)
    .set({
      // clientId is set to itself so the SET clause is never empty.
      clientId: body.CLIENT_ID,
      ...(body.TITLE !== undefined ? { title: body.TITLE } : {}),
      ...(body.REDIRECT_URI !== undefined ? { redirectUri: body.REDIRECT_URI } : {}),
      ...(body.SCOPE !== undefined ? { scope: normalizeScope(body.SCOPE) } : {}),
    })
    .where(and(eq(applications.clientId, body.CLIENT_ID), eq(applications.portalId, ctx.portal.id)))
    .returning({ id: applications.id });
  if (updated.length === 0) fail('ERROR_OAUTH', 'Application not found');
  return true;
});

export const applicationDelete = defineMethod<DeleteBody>(deleteSchema, async (ctx, body) => {
  // token_pairs rows go with the application (ON DELETE CASCADE).
  const deleted = await ctx.db
    .delete(applications)
    .where(and(eq(applications.clientId, body.CLIENT_ID), eq(applications.portalId, ctx.portal.id)))
    .returning({ id: applications.id });
  if (deleted.length === 0) fail('ERROR_OAUTH', 'Application not found');
  return true;
});

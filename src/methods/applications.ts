import { randomInt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { defineMethod, fail } from '../bitrix.js';
import { applications, marketplaceApps } from '../schema.js';
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
  const scope = normalizeScope(body.SCOPE);
  await ctx.db.insert(applications).values({
    portalId: ctx.portal.id,
    clientId,
    secretHash: sha256(clientSecret),
    title: body.TITLE,
    redirectUri: body.REDIRECT_URI,
    scope,
  });
  return {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: body.REDIRECT_URI,
    scope,
  };
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

type InstallBody = { CLIENT_ID: string; VERSION: string | number };

// The portal always sends VERSION. CHECK_HASH and INSTALL_HASH protect paid installs in the
// cloud; the catalog is the access control here, so the server ignores them.
const installSchema = {
  type: 'object',
  required: ['CLIENT_ID', 'VERSION'],
  properties: {
    CLIENT_ID: { type: 'string' },
    VERSION: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
  },
} as const;

export const applicationInstall = defineMethod<InstallBody>(installSchema, async (ctx, body) => {
  const [entry] = await ctx.db
    .select()
    .from(marketplaceApps)
    .where(eq(marketplaceApps.clientId, body.CLIENT_ID))
    .limit(1);
  if (!entry) {
    fail(
      'ERROR_OAUTH',
      'Application is not in the PocketAuth24 catalog',
      400,
      'client_id_not_in_catalog',
    );
  }
  // The upsert keeps the row id, so the tokens of an earlier install stay valid.
  await ctx.db
    .insert(applications)
    .values({
      portalId: ctx.portal.id,
      clientId: entry.clientId,
      secretHash: null,
      title: entry.title,
      redirectUri: '',
      scope: entry.scope,
      marketplaceAppId: entry.id,
    })
    .onConflictDoUpdate({
      target: [applications.portalId, applications.clientId],
      set: { title: entry.title, scope: entry.scope },
    });
  return {
    client_id: entry.clientId,
    version: Number(body.VERSION),
    status: 'F',
    scope: entry.scope.split(',').filter(Boolean),
  };
});

export const applicationInstallSubscription = defineMethod<Record<string, unknown>>(
  { type: 'object' },
  async () =>
    fail(
      'ERROR_OAUTH',
      'Subscription applications are not supported',
      400,
      'subscription_not_supported',
    ),
);

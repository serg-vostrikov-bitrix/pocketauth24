import { and, eq } from 'drizzle-orm';
import { defineMethod, fail } from '../bitrix.js';
import { applications } from '../schema.js';
import { check, intersectScope, issuePair, localUserId, normalizeScope } from '../tokens.js';
import { scopeSchema } from './applications.js';

type AuthorizeBody = {
  CLIENT_ID: string;
  SCOPE?: string | string[];
  PARAMS: Record<string, unknown>;
};

const authorizeSchema = {
  type: 'object',
  required: ['CLIENT_ID'],
  properties: {
    CLIENT_ID: { type: 'string' },
    SCOPE: scopeSchema,
    PARAMS: { type: 'object', default: {} },
  },
} as const;

export const restAuthorize = defineMethod<AuthorizeBody>(authorizeSchema, async (ctx, body) => {
  const [app] = await ctx.db
    .select()
    .from(applications)
    .where(and(eq(applications.clientId, body.CLIENT_ID), eq(applications.portalId, ctx.portal.id)))
    .limit(1);
  if (!app) fail('ERROR_OAUTH', 'Application not installed');
  return issuePair(ctx.db, ctx.config, app, ctx.portal, {
    scope: intersectScope(normalizeScope(body.SCOPE), app.scope),
    userId: localUserId(body.PARAMS.LOCAL_USER),
    params: body.PARAMS,
  });
});

type CheckBody = { TOKEN: string };

const checkSchema = {
  type: 'object',
  required: ['TOKEN'],
  properties: { TOKEN: { type: 'string' } },
} as const;

export const restCheck = defineMethod<CheckBody>(checkSchema, async (ctx, body) =>
  check(ctx.db, ctx.portal, body.TOKEN),
);

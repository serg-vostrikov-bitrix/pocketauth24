import { and, eq } from 'drizzle-orm';
import { defineMethod, fail } from '../bitrix.js';
import { applications } from '../schema.js';
import { intersectScope, issuePair, normalizeScope } from '../tokens.js';
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
  const userId = Number(body.PARAMS.LOCAL_USER ?? 0);
  return issuePair(ctx.db, ctx.config, app, ctx.portal, {
    scope: intersectScope(normalizeScope(body.SCOPE), app.scope),
    userId: Number.isInteger(userId) ? userId : 0,
    params: body.PARAMS,
  });
});

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNotNull, lt, lte, notInArray, sql } from 'drizzle-orm';
import { fail } from './bitrix.js';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, type Config } from './config.js';
import type { Db } from './db.js';
import { applications, portals, tokenPairs, type Application, type Portal } from './schema.js';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function hashMatches(hashHex: string, plain: string): boolean {
  const expected = Buffer.from(hashHex, 'hex');
  const actual = Buffer.from(sha256(plain), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function splitScope(scope: string): string[] {
  return scope
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// The portal may send SCOPE as "a,b" or as SCOPE[]=a&SCOPE[]=b; store "a,b".
export function normalizeScope(value: string | string[] | undefined): string {
  const joined = Array.isArray(value) ? value.join(',') : (value ?? '');
  return [...new Set(splitScope(joined))].join(',');
}

export function intersectScope(requested: string, appScope: string): string {
  const allowed = splitScope(appScope);
  const wanted = splitScope(requested);
  if (wanted.length === 0) return allowed.join(',');
  return wanted.filter((item) => allowed.includes(item)).join(',');
}

export function memberId(portal: Portal): string {
  return createHash('md5').update(portal.clientId).digest('hex');
}

export function portalDomain(portal: Portal): string {
  return new URL(portal.origin).host;
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires: number;
  expires_in: number;
  scope: string;
  domain: string;
  server_endpoint: string;
  client_endpoint: string;
  member_id: string;
  status: 'L';
};

export type RefreshResponse = TokenResponse & { user_id: number };

export type IssueInput = {
  scope: string;
  userId: number;
  params: Record<string, unknown>;
  // Set by a refresh: the presented pair becomes "used" and can be pruned later.
  refreshedPairId?: number;
  // The caller does not deliver the refresh token, so nobody can use it: the new pair is "used"
  // from the start.
  markUsed?: boolean;
};

export function tokenResponse(
  config: Config,
  portal: Portal,
  pair: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    scope: string;
  },
): TokenResponse {
  return {
    access_token: pair.accessToken,
    refresh_token: pair.refreshToken,
    expires: Math.floor(pair.accessExpiresAt.getTime() / 1000),
    expires_in: ACCESS_TTL_SECONDS,
    scope: pair.scope,
    domain: portalDomain(portal),
    server_endpoint: `${config.baseUrl}/rest/`,
    client_endpoint: `${portal.origin}/rest/`,
    member_id: memberId(portal),
    status: 'L',
  };
}

export async function issuePair(
  db: Db,
  config: Config,
  app: Application,
  portal: Portal,
  input: IssueInput,
): Promise<TokenResponse> {
  const now = Date.now(); // expiry is computed in app code so fake timers apply in tests
  const accessToken = randomHex(32);
  const refreshToken = randomHex(32);
  const accessExpiresAt = new Date(now + ACCESS_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(now + REFRESH_TTL_SECONDS * 1000);
  await db.transaction(async (tx) => {
    if (input.refreshedPairId !== undefined) {
      // Keeps the time of the first use. The row lock also serializes refreshes of one token, and
      // a pair pruned since refresh() read it gets invalid_grant (the throw rolls back).
      const marked = await tx
        .update(tokenPairs)
        .set({
          refreshedAt: sql`coalesce(${tokenPairs.refreshedAt}, ${new Date(now).toISOString()}::timestamptz)`,
        })
        .where(eq(tokenPairs.id, input.refreshedPairId))
        .returning({ id: tokenPairs.id });
      if (marked.length === 0) fail('invalid_grant', '', 400, 'refresh_token_pruned');
    }
    await tx.insert(tokenPairs).values({
      applicationId: app.id,
      accessHash: sha256(accessToken),
      refreshHash: sha256(refreshToken),
      userId: input.userId,
      scope: input.scope,
      params: input.params,
      accessExpiresAt,
      refreshExpiresAt,
      refreshedAt: input.markUsed ? new Date(now) : null,
    });
    const keep = config.tokenPruningKeep;
    if (keep === null) return;
    // Only used pairs can go: the server cannot know which unused pair a backend keeps (for
    // example the refresh token from the install). Keep the newest `keep` used pairs and every
    // pair with a live access token.
    const usedOfOwner = and(
      eq(tokenPairs.applicationId, app.id),
      eq(tokenPairs.userId, input.userId),
      isNotNull(tokenPairs.refreshedAt),
    );
    await tx
      .delete(tokenPairs)
      .where(
        and(
          usedOfOwner,
          lte(tokenPairs.accessExpiresAt, new Date(now)),
          notInArray(
            tokenPairs.id,
            tx
              .select({ id: tokenPairs.id })
              .from(tokenPairs)
              .where(usedOfOwner)
              .orderBy(desc(tokenPairs.createdAt), desc(tokenPairs.id))
              .limit(keep),
          ),
        ),
      );
  });
  return tokenResponse(config, portal, {
    accessToken,
    refreshToken,
    accessExpiresAt,
    scope: input.scope,
  });
}

export type CheckResult = {
  access_token: string;
  expires_in: number;
  expires: number;
  scope: string;
  client_id: string;
  parameters: Record<string, unknown>;
  status: 'L';
};

// The cloud returns numeric PARAMS values (LOCAL_USER, TZ_OFFSET, ...) as numbers.
function numericParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === 'string' && /^(0|-?[1-9]\d{0,14})$/.test(value) ? Number(value) : value,
    ]),
  );
}

export async function check(db: Db, portal: Portal, token: string): Promise<CheckResult> {
  const [row] = await db
    .select({ pair: tokenPairs, clientId: applications.clientId })
    .from(tokenPairs)
    .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
    .where(and(eq(tokenPairs.accessHash, sha256(token)), eq(applications.portalId, portal.id)))
    .limit(1);
  if (!row) fail('invalid_token', 'Unable to get application by token');
  if (row.pair.accessExpiresAt.getTime() <= Date.now()) {
    fail('expired_token', 'The access token provided has expired', 401);
  }
  const expires = Math.floor(row.pair.accessExpiresAt.getTime() / 1000);
  return {
    access_token: token,
    expires_in: Math.max(0, expires - Math.floor(Date.now() / 1000)),
    expires,
    scope: row.pair.scope,
    client_id: row.clientId,
    parameters: numericParams(row.pair.params),
    status: 'L',
  };
}

export type RefreshInput = { clientId: string; clientSecret: string; refreshToken: string };

export async function refresh(
  db: Db,
  config: Config,
  input: RefreshInput,
): Promise<RefreshResponse> {
  const [row] = await db
    .select({ pair: tokenPairs, app: applications, portal: portals })
    .from(tokenPairs)
    .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
    .innerJoin(portals, eq(applications.portalId, portals.id))
    .where(eq(tokenPairs.refreshHash, sha256(input.refreshToken)))
    .limit(1);
  // The cloud gives no description here, so the log-only reason tells the cases apart.
  if (!row) fail('invalid_grant', '', 400, 'refresh_token_unknown');
  if (row.app.clientId !== input.clientId) {
    fail('invalid_client', '', 400, 'client_id_mismatch');
  }
  if (!hashMatches(row.app.secretHash, input.clientSecret)) {
    fail('invalid_client', '', 400, 'client_secret_mismatch');
  }
  if (row.pair.refreshExpiresAt.getTime() <= Date.now()) {
    fail('invalid_grant', '', 400, 'refresh_token_expired');
  }
  // The old pair stays valid until its own expiry (reusable refresh tokens, spec D3).
  const issued = await issuePair(db, config, row.app, row.portal, {
    scope: row.pair.scope,
    userId: row.pair.userId,
    params: row.pair.params,
    refreshedPairId: row.pair.id,
  });
  // The cloud answers a refresh with the literal scope "app" and its own (OAuth server) host;
  // the pair keeps the real scope internally.
  return {
    ...issued,
    scope: 'app',
    domain: new URL(config.baseUrl).host,
    user_id: row.pair.userId,
  };
}

export async function deleteExpiredPairs(db: Db, now: Date): Promise<void> {
  await db.delete(tokenPairs).where(lt(tokenPairs.refreshExpiresAt, now));
}

const INT4_MAX = 2_147_483_647;

// LOCAL_USER comes from the portal as a string; anything that is not a valid user id means "no user".
export function localUserId(value: unknown): number {
  const id = Number(value ?? 0);
  return Number.isInteger(id) && id >= 0 && id <= INT4_MAX ? id : 0;
}

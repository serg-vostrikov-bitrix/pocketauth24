import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
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
  user_id: number;
  status: 'L';
};

export type IssueInput = { scope: string; userId: number; params: Record<string, unknown> };

export function tokenResponse(
  config: Config,
  portal: Portal,
  pair: {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    scope: string;
    userId: number;
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
    user_id: pair.userId,
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
  await db.insert(tokenPairs).values({
    applicationId: app.id,
    accessHash: sha256(accessToken),
    refreshHash: sha256(refreshToken),
    userId: input.userId,
    scope: input.scope,
    params: input.params,
    accessExpiresAt,
    refreshExpiresAt,
  });
  return tokenResponse(config, portal, {
    accessToken,
    refreshToken,
    accessExpiresAt,
    scope: input.scope,
    userId: input.userId,
  });
}

export type CheckResult = {
  client_id: string;
  expires: number;
  scope: string;
  member_id: string;
  user_id: number;
  parameters: Record<string, unknown>;
};

export async function check(db: Db, portal: Portal, token: string): Promise<CheckResult> {
  const [row] = await db
    .select({ pair: tokenPairs, clientId: applications.clientId })
    .from(tokenPairs)
    .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
    .where(and(eq(tokenPairs.accessHash, sha256(token)), eq(applications.portalId, portal.id)))
    .limit(1);
  if (!row) fail('invalid_token', 'The access token provided is invalid', 401);
  if (row.pair.accessExpiresAt.getTime() <= Date.now()) {
    fail('expired_token', 'The access token provided has expired', 401);
  }
  return {
    client_id: row.clientId,
    expires: Math.floor(row.pair.accessExpiresAt.getTime() / 1000),
    scope: row.pair.scope,
    member_id: memberId(portal),
    user_id: row.pair.userId,
    parameters: row.pair.params,
  };
}

export type RefreshInput = { clientId: string; clientSecret: string; refreshToken: string };

export async function refresh(db: Db, config: Config, input: RefreshInput): Promise<TokenResponse> {
  const [row] = await db
    .select({ pair: tokenPairs, app: applications, portal: portals })
    .from(tokenPairs)
    .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
    .innerJoin(portals, eq(applications.portalId, portals.id))
    .where(eq(tokenPairs.refreshHash, sha256(input.refreshToken)))
    .limit(1);
  if (!row) fail('invalid_grant', 'Invalid refresh token');
  if (row.app.clientId !== input.clientId || !hashMatches(row.app.secretHash, input.clientSecret)) {
    fail('invalid_client', 'Invalid client credentials', 401);
  }
  if (row.pair.refreshExpiresAt.getTime() <= Date.now()) {
    fail('invalid_grant', 'Refresh token has expired');
  }
  // The old pair stays valid until its own expiry (reusable refresh tokens, spec D3).
  return issuePair(db, config, row.app, row.portal, {
    scope: row.pair.scope,
    userId: row.pair.userId,
    params: row.pair.params,
  });
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

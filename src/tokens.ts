import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, type Config } from './config.js';
import type { Db } from './db.js';
import { tokenPairs, type Application, type Portal } from './schema.js';

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

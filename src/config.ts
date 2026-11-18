export const ACCESS_TTL_SECONDS = 3600;
export const REFRESH_TTL_SECONDS = 180 * 24 * 60 * 60;
export const EVENT_TIMEOUT_MS = 10_000;
export const EVENT_IN_FLIGHT_CAP = 200;
// Half of the global cap: a portal sends all events of one hit in one batch with no size
// limit, so a fast handler must take a large burst, and other hosts still keep 100 slots.
export const EVENT_HOST_IN_FLIGHT_CAP = 100;
export const LOG_LEVEL = 'info';
export const PORT = 3000;
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const STATUS_CACHE_MS = 10_000;
export const BODY_LIMIT_BYTES = 10 * 1024 * 1024;
export const QS_OPTIONS = { depth: 20, parameterLimit: 10_000, arrayLimit: 1000 } as const;
// CLI only; generated viewer passwords have 20 characters.
export const MIN_PASSWORD_LENGTH = 12;

export type Config = {
  baseUrl: string;
  databaseUrl: string;
  portalAllowlist: string[];
};

export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = requiredEnv(env, 'BASE_URL').replace(/\/+$/, '');
  new URL(baseUrl); // throws on an invalid URL at boot
  return {
    baseUrl,
    databaseUrl: requiredEnv(env, 'DATABASE_URL'),
    portalAllowlist: requiredEnv(env, 'PORTAL_ALLOWLIST')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  };
}

import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import qs from 'qs';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';

// Tests TRUNCATE this database; never point it at real data.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://b24auth:b24auth@localhost:5432/b24auth_test';
export const PORTAL = 'https://portal.test';
export const OTHER_PORTAL = 'https://other.test';
export const TEST_CONFIG: Config = {
  baseUrl: 'https://auth.test',
  databaseUrl: TEST_DATABASE_URL,
  portalAllowlist: ['portal.test', 'other.test'],
};

export type LogLine = { level: number; msg: string; [key: string]: unknown };
export type TestApp = {
  app: FastifyInstance;
  db: Db;
  logs: LogLine[];
  close: () => Promise<void>;
};

export async function startApp(): Promise<TestApp> {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  const logs: LogLine[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line) logs.push(JSON.parse(line) as LogLine);
      }
      callback();
    },
  });
  const app = await buildApp({ config: TEST_CONFIG, db, logStream });
  return {
    app,
    db,
    logs,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE portals, applications, token_pairs RESTART IDENTITY CASCADE`);
}

export function form(body: Record<string, unknown>): {
  headers: Record<string, string>;
  payload: string;
} {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: qs.stringify(body),
  };
}

export type Credentials = { client_id: string; client_secret: string };

export async function registerPortal(
  app: FastifyInstance,
  redirectUri = `${PORTAL}/`,
): Promise<Credentials> {
  const res = await app.inject({
    method: 'POST',
    url: '/oauth/register/',
    ...form({ redirect_uri: redirectUri, type: 'B' }),
  });
  return res.json<Credentials>();
}

export type RpcResponse<T> = {
  status: number;
  body: { result?: T; error?: string; error_description?: string };
};

export async function rpc<T = unknown>(
  app: FastifyInstance,
  creds: Credentials,
  method: string,
  body: Record<string, unknown> = {},
): Promise<RpcResponse<T>> {
  const res = await app.inject({
    method: 'POST',
    url: `/rest/${method}`,
    ...form({ ...creds, ...body }),
  });
  return { status: res.statusCode, body: res.json<RpcResponse<T>['body']>() };
}

import { createHash } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import qs from 'qs';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createDb, type Db } from '../src/db.js';
import type { TokenResponse } from '../src/tokens.js';

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

export const APP_FIELDS = {
  TITLE: 'Demo app',
  REDIRECT_URI: 'https://app.test/handler',
  SCOPE: 'crm,user',
};

export async function addApp(
  app: FastifyInstance,
  portal: Credentials,
  fields: Record<string, unknown> = APP_FIELDS,
): Promise<Credentials> {
  const res = await rpc<Credentials>(app, portal, 'application.add', fields);
  if (!res.body.result) throw new Error(`application.add failed: ${JSON.stringify(res.body)}`);
  return res.body.result;
}

export function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

export async function authorize(
  app: FastifyInstance,
  portal: Credentials,
  appClientId: string,
  extra: Record<string, unknown> = {},
): Promise<TokenResponse> {
  const res = await rpc<TokenResponse>(app, portal, 'rest.authorize', {
    CLIENT_ID: appClientId,
    SCOPE: 'crm,user',
    PARAMS: { LOCAL_USER: '5', TZ_OFFSET: '10800' },
    ...extra,
  });
  if (!res.body.result) throw new Error(`rest.authorize failed: ${JSON.stringify(res.body)}`);
  return res.body.result;
}

export async function tokenRequest(
  app: FastifyInstance,
  method: 'GET' | 'POST',
  params: Record<string, string>,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  return method === 'GET'
    ? app.inject({ method: 'GET', url: `/oauth/token/?${qs.stringify(params)}` })
    : app.inject({ method: 'POST', url: '/oauth/token/', ...form(params) });
}

export type HandlerServer = {
  url: string;
  requests: Record<string, unknown>[];
  release: () => void;
  close: () => Promise<void>;
};

// Local event handler. With hold: true it records each request but never answers
// until release() or close().
export async function startHandler(options: { hold?: boolean } = {}): Promise<HandlerServer> {
  const requests: Record<string, unknown>[] = [];
  const held: ServerResponse[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      requests.push(qs.parse(raw, { depth: 20, parameterLimit: 10_000, arrayLimit: 1000 }));
      if (options.hold) held.push(res);
      else res.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const release = (): void => {
    for (const res of held.splice(0)) res.end('ok');
  };
  return {
    url: `http://127.0.0.1:${port}/handler`,
    requests,
    release,
    close: async () => {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function eventItem(
  url: string,
  overrides: {
    client_id?: string;
    event?: string;
    auth?: Record<string, unknown>;
    additional?: Record<string, unknown>;
    data?: unknown;
  } = {},
): Record<string, unknown> {
  return {
    client_id: overrides.client_id, // undefined is dropped by qs.stringify
    auth: overrides.auth ?? { LOCAL_USER: '0', application_token: 'apptoken123' },
    query: {
      QUERY_URL: url,
      QUERY_DATA: {
        event: overrides.event ?? 'ONCRMDEALADD',
        event_handler_id: '7',
        data: overrides.data ?? { FIELDS: { ID: '42' } },
        ts: '1763460000',
      },
    },
    additional: overrides.additional ?? { sendAuth: '0', sendRefreshToken: '0' },
  };
}

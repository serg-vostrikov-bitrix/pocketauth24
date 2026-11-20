import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sha256, type TokenResponse } from '../../src/tokens.js';
import { rpc, startApp, TEST_DATABASE_URL, tokenRequest } from '../helpers.js';

const MIGRATION_DB = 'b24auth_test_migration';

function urlFor(name: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function adminQuery(text: string): Promise<void> {
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  try {
    await admin.query(text);
  } finally {
    await admin.end();
  }
}

let oldFolder: string;
beforeAll(async () => {
  await adminQuery(`DROP DATABASE IF EXISTS "${MIGRATION_DB}"`);
  await adminQuery(`CREATE DATABASE "${MIGRATION_DB}"`);
  // A copy of drizzle/ that knows only the migrations before 0004.
  oldFolder = mkdtempSync(join(tmpdir(), 'pa24-migrations-'));
  cpSync('drizzle', oldFolder, { recursive: true });
  const journalPath = join(oldFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx < 4);
  writeFileSync(journalPath, JSON.stringify(journal));
});
afterAll(async () => {
  rmSync(oldFolder, { recursive: true, force: true });
  await adminQuery(`DROP DATABASE IF EXISTS "${MIGRATION_DB}"`);
});

it('Migration 0004 keeps an existing local application working', { timeout: 30_000 }, async () => {
  const pool = new pg.Pool({ connectionString: urlFor(MIGRATION_DB) });
  try {
    await migrate(drizzle(pool), { migrationsFolder: oldFolder });
    const [portal] = (
      await pool.query<{ id: number }>(
        `insert into portals (origin, client_id, secret_hash)
           values ('https://portal.test', 'portal.client', $1) returning id`,
        [sha256('portal-secret')],
      )
    ).rows;
    await pool.query(
      `insert into applications (portal_id, client_id, secret_hash, title, redirect_uri, scope)
         values ($1, 'local.0123456789abcd.00000001', $2, 'Old app', '', 'crm,user')`,
      [portal.id, sha256('app-secret')],
    );
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }

  const t = await startApp({ databaseUrl: urlFor(MIGRATION_DB) });
  try {
    const creds = { client_id: 'portal.client', client_secret: 'portal-secret' };
    const res = await rpc<TokenResponse>(t.app, creds, 'rest.authorize', {
      CLIENT_ID: 'local.0123456789abcd.00000001',
      PARAMS: { LOCAL_USER: '5' },
    });
    expect(res.body.result?.status).toBe('L');
    const renewed = await tokenRequest(t.app, 'POST', {
      grant_type: 'refresh_token',
      client_id: 'local.0123456789abcd.00000001',
      client_secret: 'app-secret',
      refresh_token: String(res.body.result?.refresh_token),
    });
    expect(renewed.statusCode).toBe(200);
  } finally {
    await t.close();
  }

  // Storage contract of the new indexes: one Marketplace client_id on many portals, and a
  // local client_id still unique in the whole database.
  const check = new pg.Pool({ connectionString: urlFor(MIGRATION_DB) });
  try {
    const other = (
      await check.query<{ id: number }>(
        `insert into portals (origin, client_id, secret_hash)
           values ('https://other.test', 'other.client', $1) returning id`,
        [sha256('other-secret')],
      )
    ).rows[0];
    const entry = (
      await check.query<{ id: number }>(
        `insert into marketplace_apps (client_id, secret_hash, title, scope)
           values ('app.a1.1', $1, 'Partner app', 'crm') returning id`,
        [sha256('partner-secret')],
      )
    ).rows[0];
    const first = (
      await check.query<{ id: number }>(`select id from portals where client_id = 'portal.client'`)
    ).rows[0];
    for (const portalId of [first.id, other.id]) {
      await check.query(
        `insert into applications (portal_id, client_id, secret_hash, title, redirect_uri, scope, marketplace_app_id)
           values ($1, 'app.a1.1', null, 'Partner app', '', 'crm', $2)`,
        [portalId, entry.id],
      );
    }
    await expect(
      check.query(
        `insert into applications (portal_id, client_id, secret_hash, title, redirect_uri, scope)
           values ($1, 'local.0123456789abcd.00000001', 'x', 'Copy', '', 'crm')`,
        [other.id],
      ),
    ).rejects.toThrow(/applications_local_client_id_idx/);
  } finally {
    await check.end();
  }
});

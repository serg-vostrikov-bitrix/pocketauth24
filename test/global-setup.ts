import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { TEST_DATABASE_URL } from './helpers.js';

export async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
}

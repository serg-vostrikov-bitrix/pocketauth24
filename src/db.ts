import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  // Without it, a request to an unreachable host waits for the OS TCP timeout.
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
  return { db: drizzle(pool, { schema }), pool };
}

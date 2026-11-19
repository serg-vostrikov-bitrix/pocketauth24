import { count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db.js';
import { applications, portals } from '../schema.js';
import { PAGE_SIZE, parseQuery, selection, type Column } from './filters.js';

type Query = { Querystring: Record<string, unknown> };

// The select lists name each field. No query selects secret_hash, access_hash, refresh_hash
// or params.
const PORTAL_COLUMNS: readonly Column[] = [
  { key: 'id', sql: portals.id, filter: 'id' },
  { key: 'origin', sql: portals.origin, filter: 'text' },
  { key: 'clientId', sql: portals.clientId, filter: 'text' },
  {
    key: 'applications',
    sql: sql<number>`(select count(*)::int from ${applications} where ${applications.portalId} = ${portals.id})`,
    filter: 'none',
  },
  { key: 'createdAt', sql: portals.createdAt, filter: 'date' },
];

const APPLICATION_COLUMNS: readonly Column[] = [
  { key: 'id', sql: applications.id, filter: 'id' },
  { key: 'portal', sql: portals.origin, filter: 'text' },
  { key: 'clientId', sql: applications.clientId, filter: 'text' },
  { key: 'title', sql: applications.title, filter: 'text' },
  { key: 'redirectUri', sql: applications.redirectUri, filter: 'text' },
  { key: 'scope', sql: applications.scope, filter: 'text' },
  { key: 'createdAt', sql: applications.createdAt, filter: 'date' },
];

function invalidFilter(reply: FastifyReply, column: string): FastifyReply {
  return reply.status(400).send({ error: 'invalid_filter', column });
}

// Read-only: this module registers GET routes only.
export function dataRoutes(app: FastifyInstance, db: Db): void {
  app.get<Query>('/portals', async (request, reply) => {
    const q = parseQuery(PORTAL_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(PORTAL_COLUMNS))
        .from(portals)
        .where(q.where)
        .orderBy(desc(portals.createdAt), desc(portals.id))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db.select({ total: count() }).from(portals).where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });

  app.get<Query>('/applications', async (request, reply) => {
    const q = parseQuery(APPLICATION_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(APPLICATION_COLUMNS))
        .from(applications)
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where)
        .orderBy(desc(applications.createdAt), desc(applications.id))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db
        .select({ total: count() })
        .from(applications)
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });
}

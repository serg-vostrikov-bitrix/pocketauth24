import { asc, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db.js';
import { applications, eventCounters, portals, tokenPairs } from '../schema.js';
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

const TOKEN_COLUMNS: readonly Column[] = [
  { key: 'id', sql: tokenPairs.id, filter: 'id' },
  { key: 'portal', sql: portals.origin, filter: 'text' },
  { key: 'application', sql: applications.title, filter: 'text' },
  { key: 'clientId', sql: applications.clientId, filter: 'text' },
  { key: 'userId', sql: tokenPairs.userId, filter: 'id' },
  { key: 'scope', sql: tokenPairs.scope, filter: 'text' },
  { key: 'createdAt', sql: tokenPairs.createdAt, filter: 'date' },
  { key: 'accessExpiresAt', sql: tokenPairs.accessExpiresAt, filter: 'date' },
  { key: 'refreshExpiresAt', sql: tokenPairs.refreshExpiresAt, filter: 'date' },
  // The state uses the access token expiry; the hourly cleanup deletes pairs with an expired
  // refresh token.
  {
    key: 'state',
    sql: sql<string>`case when ${tokenPairs.accessExpiresAt} > now() then 'active' else 'expired' end`,
    filter: 'enum',
    values: ['active', 'expired'],
  },
];

const EVENT_COLUMNS: readonly Column[] = [
  { key: 'day', sql: eventCounters.day, filter: 'date' },
  {
    key: 'outcome',
    sql: eventCounters.outcome,
    filter: 'enum',
    values: ['delivered', 'failed', 'dropped'],
  },
  { key: 'count', sql: eventCounters.count, filter: 'none' },
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

  app.get<Query>('/tokens', async (request, reply) => {
    const q = parseQuery(TOKEN_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(TOKEN_COLUMNS))
        .from(tokenPairs)
        .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where)
        .orderBy(desc(tokenPairs.createdAt), desc(tokenPairs.id))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db
        .select({ total: count() })
        .from(tokenPairs)
        .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
        .innerJoin(portals, eq(applications.portalId, portals.id))
        .where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });

  // event_counters has no id column; outcome breaks ties within a day.
  app.get<Query>('/events', async (request, reply) => {
    const q = parseQuery(EVENT_COLUMNS, request.query);
    if (!q.ok) return invalidFilter(reply, q.column);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select(selection(EVENT_COLUMNS))
        .from(eventCounters)
        .where(q.where)
        .orderBy(desc(eventCounters.day), asc(eventCounters.outcome))
        .limit(PAGE_SIZE)
        .offset(q.offset),
      db.select({ total: count() }).from(eventCounters).where(q.where),
    ]);
    return { rows, total, page: q.page, pageSize: PAGE_SIZE };
  });
}

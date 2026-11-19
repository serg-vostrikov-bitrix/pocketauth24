import { readFileSync } from 'node:fs';
import { gte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { STATUS_CACHE_MS } from './config.js';
import type { Db } from './db.js';
import { utcDay } from './eventCounters.js';
import { applications, eventCounters, portals, tokenPairs, type Outcome } from './schema.js';

export type EventTotals = Record<Outcome, number>;
export type Status = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'down';
  version: string;
  portals: number | null;
  applications: number | null;
  activeTokenPairs: number | null;
  events: { today: EventTotals; last7Days: EventTotals } | null;
};

// Resolves to the repository root from both src/ and dist/.
export const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function probeDatabase(
  db: Db,
  log: FastifyBaseLogger,
  timeoutMs = 2000,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('database_probe_timeout')), timeoutMs);
  });
  try {
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return true;
  } catch (err) {
    log.warn({ err }, 'database_probe_failed');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function emptyTotals(): EventTotals {
  return { delivered: 0, failed: 0, dropped: 0 };
}

// Never rejects: a failed query gives database 'down' and null statistics.
async function computeStatus(db: Db, version: string, log: FastifyBaseLogger): Promise<Status> {
  const now = new Date();
  const today = utcDay(now);
  const firstDay = utcDay(new Date(now.getTime() - 6 * DAY_MS));
  try {
    const [portalCount, applicationCount, activeTokenPairs, rows] = await Promise.all([
      db.$count(portals),
      db.$count(applications),
      db.$count(tokenPairs, sql`${tokenPairs.refreshExpiresAt} > now()`),
      db
        .select({
          day: eventCounters.day,
          outcome: eventCounters.outcome,
          count: sql<string>`sum(${eventCounters.count})`,
        })
        .from(eventCounters)
        .where(gte(eventCounters.day, firstDay))
        .groupBy(eventCounters.day, eventCounters.outcome),
    ]);
    const events = { today: emptyTotals(), last7Days: emptyTotals() };
    for (const row of rows) {
      const count = Number(row.count);
      events.last7Days[row.outcome] += count;
      if (row.day === today) events.today[row.outcome] += count;
    }
    return {
      status: 'ok',
      database: 'ok',
      version,
      portals: portalCount,
      applications: applicationCount,
      activeTokenPairs,
      events,
    };
  } catch (err) {
    log.error({ err }, 'status_query_failed');
    return {
      status: 'degraded',
      database: 'down',
      version,
      portals: null,
      applications: null,
      activeTokenPairs: null,
      events: null,
    };
  }
}

// Caches the promise from the start of the computation, so concurrent calls share one set of
// queries.
export function createStatusService(deps: { db: Db; version: string; log: FastifyBaseLogger }): {
  get: () => Promise<Status>;
} {
  let cached: { at: number; promise: Promise<Status> } | null = null;
  return {
    get: () => {
      const now = Date.now();
      if (!cached || now - cached.at >= STATUS_CACHE_MS) {
        cached = { at: now, promise: computeStatus(deps.db, deps.version, deps.log) };
      }
      return cached.promise;
    },
  };
}

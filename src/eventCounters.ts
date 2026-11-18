import { sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { eventCounters, type Outcome } from './schema.js';

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function recordOutcome(db: Db, outcome: Outcome, now: Date, n = 1): Promise<void> {
  await db
    .insert(eventCounters)
    .values({ day: utcDay(now), outcome, count: n })
    .onConflictDoUpdate({
      target: [eventCounters.day, eventCounters.outcome],
      set: { count: sql`${eventCounters.count} + ${n}` },
    });
}

import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const portals = pgTable('portals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  origin: text('origin').notNull().unique(),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable('applications', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  portalId: bigint('portal_id', { mode: 'number' })
    .notNull()
    .references(() => portals.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  title: text('title').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tokenPairs = pgTable(
  'token_pairs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    applicationId: bigint('application_id', { mode: 'number' })
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    accessHash: text('access_hash').notNull().unique(),
    refreshHash: text('refresh_hash').notNull().unique(),
    userId: integer('user_id').notNull(),
    scope: text('scope').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('token_pairs_refresh_expires_at_idx').on(table.refreshExpiresAt)],
);

export type Portal = typeof portals.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type TokenPair = typeof tokenPairs.$inferSelect;

export type Outcome = 'delivered' | 'failed' | 'dropped';

export const eventCounters = pgTable(
  'event_counters',
  {
    day: date('day').notNull(),
    outcome: text('outcome').$type<Outcome>().notNull(),
    count: bigint('count', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.outcome] }),
    check(
      'event_counters_outcome_check',
      sql`${table.outcome} in ('delivered', 'failed', 'dropped')`,
    ),
  ],
);

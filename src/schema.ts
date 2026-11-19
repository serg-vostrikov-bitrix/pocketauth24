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
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const portals = pgTable('portals', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  origin: text('origin').notNull().unique(),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable(
  'applications',
  {
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
  },
  (table) => [index('applications_portal_id_idx').on(table.portalId)],
);

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
  (table) => [
    index('token_pairs_refresh_expires_at_idx').on(table.refreshExpiresAt),
    // Prune query in issuePair; ON DELETE CASCADE from applications.
    index('token_pairs_app_user_created_idx').on(
      table.applicationId,
      table.userId,
      table.createdAt,
    ),
    // Admin token list sort.
    index('token_pairs_created_at_idx').on(table.createdAt),
  ],
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

export type AdminRole = 'superuser' | 'viewer';

export const adminUsers = pgTable(
  'admin_users',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    login: text('login').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<AdminRole>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // At most one superuser.
    uniqueIndex('admin_users_one_superuser')
      .on(table.role)
      .where(sql`role = 'superuser'`),
    check('admin_users_role_check', sql`${table.role} in ('superuser', 'viewer')`),
  ],
);

export const adminSessions = pgTable(
  'admin_sessions',
  {
    // SHA-256 hex of the cookie value; the cookie value itself is never stored.
    idHash: text('id_hash').primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('admin_sessions_expires_at_idx').on(table.expiresAt)],
);

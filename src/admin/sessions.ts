import { randomBytes } from 'node:crypto';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { adminSessions, adminUsers, type AdminRole } from '../schema.js';
import { sha256 } from '../tokens.js';

export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type AdminUser = { id: number; login: string; role: AdminRole };

// Returns the cookie value; the database keeps only its SHA-256.
export async function createSession(db: Db, userId: number): Promise<string> {
  const sessionId = randomBytes(32).toString('base64url');
  await db.insert(adminSessions).values({
    idHash: sha256(sessionId),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  return sessionId;
}

export async function findSession(db: Db, sessionId: string): Promise<AdminUser | null> {
  const [row] = await db
    .select({ id: adminUsers.id, login: adminUsers.login, role: adminUsers.role })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.userId, adminUsers.id))
    .where(
      and(eq(adminSessions.idHash, sha256(sessionId)), gt(adminSessions.expiresAt, sql`now()`)),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.idHash, sha256(sessionId)));
}

export async function deleteExpiredSessions(db: Db, now: Date): Promise<void> {
  await db.delete(adminSessions).where(lte(adminSessions.expiresAt, now));
}

export async function deleteSessionsOfUser(db: DbOrTx, userId: number): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.userId, userId));
}

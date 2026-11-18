import { eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import { adminSessions } from '../schema.js';

export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export async function deleteSessionsOfUser(db: DbOrTx, userId: number): Promise<void> {
  await db.delete(adminSessions).where(eq(adminSessions.userId, userId));
}

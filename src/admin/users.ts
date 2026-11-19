import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import { adminUsers, type AdminRole } from '../schema.js';
import { deleteSessionsOfUser, type AdminUser } from './sessions.js';

export const LOGIN_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const DEFAULT_SUPERUSER_LOGIN = 'admin';

// Without a login, an existing superuser keeps its login; a new one gets "admin".
// saved is false when the target login belongs to a viewer; then nothing changes.
export async function setSuperuser(
  db: Db,
  login: string | undefined,
  passwordHash: string,
): Promise<{ saved: boolean; login: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: adminUsers.id, login: adminUsers.login })
      .from(adminUsers)
      .where(eq(adminUsers.role, 'superuser'))
      .for('update');
    const target = login ?? current?.login ?? DEFAULT_SUPERUSER_LOGIN;
    const [owner] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.login, target));
    if (owner && owner.id !== current?.id) return { saved: false, login: target };
    if (current) {
      await tx
        .update(adminUsers)
        .set({ login: target, passwordHash })
        .where(eq(adminUsers.id, current.id));
      await deleteSessionsOfUser(tx, current.id);
    } else {
      await tx.insert(adminUsers).values({ login: target, passwordHash, role: 'superuser' });
    }
    return { saved: true, login: target };
  });
}

export async function hasSuperuser(db: Db): Promise<boolean> {
  return (await db.$count(adminUsers, eq(adminUsers.role, 'superuser'))) > 0;
}

export async function findUserByLogin(
  db: Db,
  login: string,
): Promise<(AdminUser & { passwordHash: string }) | null> {
  const [row] = await db
    .select({
      id: adminUsers.id,
      login: adminUsers.login,
      role: adminUsers.role,
      passwordHash: adminUsers.passwordHash,
    })
    .from(adminUsers)
    .where(eq(adminUsers.login, login))
    .limit(1);
  return row ?? null;
}

export type UserRow = { id: number; login: string; role: AdminRole; createdAt: Date };

export async function listUsers(db: Db): Promise<UserRow[]> {
  return db
    .select({
      id: adminUsers.id,
      login: adminUsers.login,
      role: adminUsers.role,
      createdAt: adminUsers.createdAt,
    })
    .from(adminUsers)
    .orderBy(asc(adminUsers.role), asc(adminUsers.id)); // 'superuser' sorts before 'viewer'
}

export async function createViewer(
  db: Db,
  login: string,
  passwordHash: string,
): Promise<{ id: number; login: string } | null> {
  const [row] = await db
    .insert(adminUsers)
    .values({ login, passwordHash, role: 'viewer' })
    .onConflictDoNothing({ target: adminUsers.login })
    .returning({ id: adminUsers.id, login: adminUsers.login });
  return row ?? null;
}

export type ViewerChange = 'ok' | 'not_found' | 'superuser';

export async function resetViewerPassword(
  db: Db,
  id: number,
  passwordHash: string,
): Promise<ViewerChange> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .for('update');
    if (!user) return 'not_found';
    if (user.role === 'superuser') return 'superuser';
    await tx.update(adminUsers).set({ passwordHash }).where(eq(adminUsers.id, id));
    await deleteSessionsOfUser(tx, id);
    return 'ok';
  });
}

// The foreign key cascade deletes the sessions of the viewer.
export async function deleteViewer(db: Db, id: number): Promise<ViewerChange> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(eq(adminUsers.id, id))
      .for('update');
    if (!user) return 'not_found';
    if (user.role === 'superuser') return 'superuser';
    await tx.delete(adminUsers).where(eq(adminUsers.id, id));
    return 'ok';
  });
}

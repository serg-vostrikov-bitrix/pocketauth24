import { eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import { adminUsers } from '../schema.js';
import { deleteSessionsOfUser } from './sessions.js';

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

import { asc, eq } from 'drizzle-orm';
import type { Db } from './db.js';
import { marketplaceApps } from './schema.js';

export type CatalogEntry = { clientId: string; secretHash: string; title: string; scope: string };

// A second add of the same client_id replaces the secret, title and scope (secret rotation).
export async function upsertCatalogEntry(db: Db, entry: CatalogEntry): Promise<void> {
  await db
    .insert(marketplaceApps)
    .values(entry)
    .onConflictDoUpdate({
      target: marketplaceApps.clientId,
      set: { secretHash: entry.secretHash, title: entry.title, scope: entry.scope },
    });
}

// No secret_hash: the list is for the operator's screen.
export async function listCatalog(
  db: Db,
): Promise<{ clientId: string; title: string; scope: string }[]> {
  return db
    .select({
      clientId: marketplaceApps.clientId,
      title: marketplaceApps.title,
      scope: marketplaceApps.scope,
    })
    .from(marketplaceApps)
    .orderBy(asc(marketplaceApps.clientId));
}

// Installs and their tokens go by ON DELETE CASCADE.
export async function removeCatalogEntry(db: Db, clientId: string): Promise<boolean> {
  const deleted = await db
    .delete(marketplaceApps)
    .where(eq(marketplaceApps.clientId, clientId))
    .returning({ id: marketplaceApps.id });
  return deleted.length > 0;
}

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { removeCatalogEntry } from '../../src/marketplace.js';
import { applications, marketplaceApps, portals, tokenPairs } from '../../src/schema.js';
import { sha256 } from '../../src/tokens.js';
import {
  addCatalogEntry,
  registerPortal,
  startApp,
  truncateAll,
  type TestApp,
} from '../helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await truncateAll(t.db);
});

// An install row and one token pair, inserted directly: the RPC install comes in a later task.
async function seedInstall(): Promise<void> {
  const creds = await registerPortal(t.app);
  const [portal] = await t.db.select().from(portals).where(eq(portals.clientId, creds.client_id));
  const [entry] = await t.db.select().from(marketplaceApps);
  const [row] = await t.db
    .insert(applications)
    .values({
      portalId: portal.id,
      clientId: entry.clientId,
      secretHash: null,
      title: entry.title,
      redirectUri: '',
      scope: entry.scope,
      marketplaceAppId: entry.id,
    })
    .returning({ id: applications.id });
  await t.db.insert(tokenPairs).values({
    applicationId: row.id,
    accessHash: sha256('access'),
    refreshHash: sha256('refresh'),
    userId: 5,
    scope: 'crm',
    params: {},
    accessExpiresAt: new Date(Date.now() + 3_600_000),
    refreshExpiresAt: new Date(Date.now() + 86_400_000),
  });
}

describe('marketplace-catalog', () => {
  it('Remove an entry', async () => {
    await addCatalogEntry(t.db);
    await seedInstall();
    expect(await removeCatalogEntry(t.db, 'app.a1.1')).toBe(true);
    expect(await t.db.$count(marketplaceApps)).toBe(0);
    expect(await t.db.$count(applications)).toBe(0);
    expect(await t.db.$count(tokenPairs)).toBe(0);
  });
});

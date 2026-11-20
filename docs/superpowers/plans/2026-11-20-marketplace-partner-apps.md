---
change: marketplace-partner-apps
design-doc: docs/superpowers/specs/2026-11-20-marketplace-partner-apps-design.md
base-ref: 34699913aeb1f6ad458ad6454641ed67e6e3229c
archived-with: 2026-11-20-marketplace-partner-apps
---

<!-- comet-task-authority: docs/openspec/changes/marketplace-partner-apps/tasks.md -->

# Marketplace Partner Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a partner serve its own Bitrix24 Marketplace application through PocketAuth24: a CLI catalog, `application.install`, `application.uninstall`, status `F` and renewal with the catalog secret.

**Architecture:** A new table `marketplace_apps` holds the catalog (CLI only). A Marketplace install is a row in `applications` with `marketplace_app_id` set and `secret_hash` null, so all token, event and admin paths keep working on `applications` rows. Renewal left-joins the catalog and checks its secret. Status comes from the row kind (`F` for an install row, `L` for a local row).

**Tech Stack:** Node.js 24, TypeScript, Fastify 5, Drizzle ORM 0.45 + drizzle-kit 0.31, PostgreSQL 17, Vitest 5.

## Global Constraints

- Requirements source: OpenSpec change `docs/openspec/changes/marketplace-partner-apps/` (proposal, design D1 to D6, delta specs). Implementation detail: the Design Doc in the frontmatter.
- English only in code, comments, docs, commit messages (CLAUDE.md rule 1).
- Write docs in ASD-STE100 style, about 80% (CLAUDE.md rule 2): active voice, "must"/"should"/"can", no "shall"/"may", short sentences.
- When `README.md` changes, make the same change in `README.de.md`, `README.it.md`, `README.es.md`, `README.pt.md`, `README.ru.md` in the same commit, with identical structure (CLAUDE.md rule 3). Use the `sepia-refactor` skill for the English text (CLAUDE.md rule 4).
- Send every API error through `fail(code, description, status, reason)` from `src/bitrix.ts`. New reasons: `client_id_not_in_catalog`, `subscription_not_supported`. List them in `docs/logging.md` (CLAUDE.md rule 5). Never log secrets, hashes or tokens.
- Exact client-visible texts:
  - `Application is not in the PocketAuth24 catalog` (`ERROR_OAUTH`, HTTP 400)
  - `Subscription applications are not supported` (`ERROR_OAUTH`, HTTP 400)
- Install result shape: `{ client_id, version: <integer>, status: 'F', scope: string[] }`.
- Catalog secrets are stored only as `sha256` hex (`sha256()` from `src/tokens.ts`, checked by `hashMatches()`). The CLI reads the secret from a hidden prompt or from stdin (`--secret-stdin`), never from an argument.
- The admin panel stays read-only. No RPC method changes the catalog.
- No new dependencies.
- Every commit ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Test prerequisites

All tests in this plan are integration tests on a real PostgreSQL.

- `test/helpers.ts` uses `TEST_DATABASE_URL`, default `postgres://b24auth:b24auth@localhost:5432/b24auth_test`. The tests TRUNCATE this database. Never point it at real data.
- Start the database: `docker compose up -d db` (service `db`, image `postgres:17` in `docker-compose.yml`).
- `test/global-setup.ts` creates the database and runs all migrations from `drizzle/` before the run.
- Run one file: `npx vitest run test/integration/<file>.test.ts`. Run one test: add `-t "<test name>"`.
- Full suite: `npm test` (runs `vitest run`). Lint: `npm run lint`. Type check: `npm run typecheck`.
- Before each commit, run `npx prettier --write <changed files>`; `npm run lint` runs `prettier --check`.

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/schema.ts` | Modify | `marketplaceApps` table; `applications.marketplaceAppId`; nullable `secretHash`; new unique indexes |
| `drizzle/0004_marketplace_apps.sql`, `drizzle/meta/0004_snapshot.json`, `drizzle/meta/_journal.json` | Generate | Migration |
| `src/marketplace.ts` | Create | Catalog database functions (`upsertCatalogEntry`, `listCatalog`, `removeCatalogEntry`) |
| `src/cli.ts` | Modify | `marketplace add/list/remove`; `withDb` helper; `setPassword` extracted |
| `src/methods/applications.ts` | Modify | `application.install`, `application.install.subscription`, `application.uninstall`; local-only update and delete |
| `src/routes/rpc.ts` | Modify | Register the three methods |
| `src/tokens.ts` | Modify | `AppStatus`, `appStatus()`, status in `tokenResponse`/`check`; catalog secret in `refresh` |
| `test/helpers.ts` | Modify | `truncateAll` includes `marketplace_apps`; `CATALOG_APP`, `addCatalogEntry`, `install` |
| `test/integration/migration.test.ts` | Create | Migration on a database with a local application |
| `test/integration/marketplace-catalog.test.ts` | Create | Catalog functions and cascade |
| `test/integration/admin-cli.test.ts` | Modify | CLI process tests |
| `test/integration/application-registry.test.ts` | Modify | Install, uninstall, update/delete limits |
| `test/integration/token-service.test.ts` | Modify | Status `F`, renewal, rotation |
| `test/integration/event-delivery.test.ts` | Modify | `ONAPPINSTALL` for an install row |
| `test/integration/admin-data.test.ts` | Modify | Install rows in the applications view |
| `docs/logging.md`, `docs/deployment.md` | Modify | Reasons; partner section |
| `README.md` + 5 translations | Modify | Limits, Why, Benefits, Features |

---

### Task 1: Data model and migration (tasks.md 1.1, 1.2)

<!-- comet-task-ref:6cdf7094-5cd9-4bad-a7a1-ff2e74deddbd --> <!-- comet-task-ref:756e369c-62c2-4be8-8b28-c7eb0712374b -->

**Files:**
- Modify: `src/schema.ts` (the `applications` table, lines 25-40; add `marketplaceApps` above it)
- Modify: `src/tokens.ts` (`refresh`, the `hashMatches(row.app.secretHash, ...)` line)
- Modify: `test/helpers.ts` (`truncateAll`)
- Generate: `drizzle/0004_marketplace_apps.sql`, `drizzle/meta/0004_snapshot.json`, `drizzle/meta/_journal.json`
- Test: `test/integration/migration.test.ts` (create)

**Interfaces:**
- Produces: `marketplaceApps` table object and `MarketplaceApp` type in `src/schema.ts`; `applications.marketplaceAppId: number | null`; `Application.secretHash: string | null`.
- Produces: `truncateAll(db)` also truncates `marketplace_apps`.

- **Step 1: Write the failing migration test**

Create `test/integration/migration.test.ts`. It builds a separate database, applies migrations 0000-0003 from a copy of `drizzle/` with a cut journal, inserts a local application with raw SQL, applies all migrations, and checks that the local application still works.

```ts
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sha256 } from '../../src/tokens.js';
import { rpc, startApp, TEST_DATABASE_URL, tokenRequest, type TokenResponse } from '../helpers.js';

const MIGRATION_DB = 'b24auth_test_migration';

function urlFor(name: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function adminQuery(text: string): Promise<void> {
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  try {
    await admin.query(text);
  } finally {
    await admin.end();
  }
}

let oldFolder: string;
beforeAll(async () => {
  await adminQuery(`DROP DATABASE IF EXISTS "${MIGRATION_DB}"`);
  await adminQuery(`CREATE DATABASE "${MIGRATION_DB}"`);
  // A copy of drizzle/ that knows only the migrations before 0004.
  oldFolder = mkdtempSync(join(tmpdir(), 'pa24-migrations-'));
  cpSync('drizzle', oldFolder, { recursive: true });
  const journalPath = join(oldFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx < 4);
  writeFileSync(journalPath, JSON.stringify(journal));
});
afterAll(async () => {
  rmSync(oldFolder, { recursive: true, force: true });
  await adminQuery(`DROP DATABASE IF EXISTS "${MIGRATION_DB}"`);
});

it(
  'Migration 0004 keeps an existing local application working',
  { timeout: 30_000 },
  async () => {
    const pool = new pg.Pool({ connectionString: urlFor(MIGRATION_DB) });
    try {
      await migrate(drizzle(pool), { migrationsFolder: oldFolder });
      const [portal] = (
        await pool.query<{ id: number }>(
          `insert into portals (origin, client_id, secret_hash)
           values ('https://portal.test', 'portal.client', $1) returning id`,
          [sha256('portal-secret')],
        )
      ).rows;
      await pool.query(
        `insert into applications (portal_id, client_id, secret_hash, title, redirect_uri, scope)
         values ($1, 'local.0123456789abcd.00000001', $2, 'Old app', '', 'crm,user')`,
        [portal.id, sha256('app-secret')],
      );
      await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    } finally {
      await pool.end();
    }

    const t = await startApp({ databaseUrl: urlFor(MIGRATION_DB) });
    try {
      const creds = { client_id: 'portal.client', client_secret: 'portal-secret' };
      const res = await rpc<TokenResponse>(t.app, creds, 'rest.authorize', {
        CLIENT_ID: 'local.0123456789abcd.00000001',
        PARAMS: { LOCAL_USER: '5' },
      });
      expect(res.body.result?.status).toBe('L');
      const renewed = await tokenRequest(t.app, 'POST', {
        grant_type: 'refresh_token',
        client_id: 'local.0123456789abcd.00000001',
        client_secret: 'app-secret',
        refresh_token: String(res.body.result?.refresh_token),
      });
      expect(renewed.statusCode).toBe(200);
    } finally {
      await t.close();
    }

    // Storage contract of the new indexes: one Marketplace client_id on many portals, and a
    // local client_id still unique in the whole database.
    const check = new pg.Pool({ connectionString: urlFor(MIGRATION_DB) });
    try {
      const other = (
        await check.query<{ id: number }>(
          `insert into portals (origin, client_id, secret_hash)
           values ('https://other.test', 'other.client', $1) returning id`,
          [sha256('other-secret')],
        )
      ).rows[0];
      const entry = (
        await check.query<{ id: number }>(
          `insert into marketplace_apps (client_id, secret_hash, title, scope)
           values ('app.a1.1', $1, 'Partner app', 'crm') returning id`,
          [sha256('partner-secret')],
        )
      ).rows[0];
      const first = (
        await check.query<{ id: number }>(`select id from portals where client_id = 'portal.client'`)
      ).rows[0];
      for (const portalId of [first.id, other.id]) {
        await check.query(
          `insert into applications (portal_id, client_id, secret_hash, title, redirect_uri, scope, marketplace_app_id)
           values ($1, 'app.a1.1', null, 'Partner app', '', 'crm', $2)`,
          [portalId, entry.id],
        );
      }
      await expect(
        check.query(
          `insert into applications (portal_id, client_id, secret_hash, title, redirect_uri, scope)
           values ($1, 'local.0123456789abcd.00000001', 'x', 'Copy', '', 'crm')`,
          [other.id],
        ),
      ).rejects.toThrow(/applications_local_client_id_idx/);
    } finally {
      await check.end();
    }
  },
);
```

Note: `TokenResponse` is exported from `src/tokens.ts`. If `test/helpers.ts` does not re-export it, import it from `../../src/tokens.js` instead.
- **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration/migration.test.ts`
Expected: FAIL. `relation "marketplace_apps" does not exist`.

- **Step 3: Change the schema**

In `src/schema.ts`, add this table above `applications`:

```ts
// The catalog of Marketplace applications that this server serves. Only the CLI changes it.
export const marketplaceApps = pgTable('marketplace_apps', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  title: text('title').notNull(),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Replace the `applications` table with:

```ts
export const applications = pgTable(
  'applications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    portalId: bigint('portal_id', { mode: 'number' })
      .notNull()
      .references(() => portals.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    // Null for a Marketplace install: its secret is in marketplace_apps.
    secretHash: text('secret_hash'),
    title: text('title').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    scope: text('scope').notNull(),
    // Null: a local application. Set: a Marketplace install of this catalog entry.
    marketplaceAppId: bigint('marketplace_app_id', { mode: 'number' }).references(
      () => marketplaceApps.id,
      { onDelete: 'cascade' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('applications_portal_id_idx').on(table.portalId),
    // A local client_id is unique in the whole database.
    uniqueIndex('applications_local_client_id_idx')
      .on(table.clientId)
      .where(sql`marketplace_app_id is null`),
    // One Marketplace client_id can be installed on many portals, once on each.
    uniqueIndex('applications_portal_client_id_idx').on(table.portalId, table.clientId),
  ],
);
```

Add next to the other types:

```ts
export type MarketplaceApp = typeof marketplaceApps.$inferSelect;
```

- **Step 4: Keep `refresh` type-safe for a null hash**

In `src/tokens.ts` `refresh`, replace:

```ts
  if (!hashMatches(row.app.secretHash, input.clientSecret)) {
```

with:

```ts
  if (row.app.secretHash === null || !hashMatches(row.app.secretHash, input.clientSecret)) {
```

Task 7 replaces this check with the catalog secret.

- **Step 5: Truncate the catalog in tests**

In `test/helpers.ts` `truncateAll`, change the statement to:

```ts
    sql`TRUNCATE portals, applications, token_pairs, marketplace_apps, event_counters, admin_users, admin_sessions RESTART IDENTITY CASCADE`,
```

- **Step 6: Generate the migration**

Run: `npx drizzle-kit generate --name marketplace_apps`
Expected: new files `drizzle/0004_marketplace_apps.sql` and `drizzle/meta/0004_snapshot.json`, and a fifth entry in `drizzle/meta/_journal.json`.

Open `drizzle/0004_marketplace_apps.sql` and check it. It must contain these statements (order of the first four can differ), separated by `--> statement-breakpoint`:

```sql
CREATE TABLE "marketplace_apps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"title" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_apps_client_id_unique" UNIQUE("client_id")
);
ALTER TABLE "applications" DROP CONSTRAINT "applications_client_id_unique";
ALTER TABLE "applications" ALTER COLUMN "secret_hash" DROP NOT NULL;
ALTER TABLE "applications" ADD COLUMN "marketplace_app_id" bigint;
ALTER TABLE "applications" ADD CONSTRAINT "applications_marketplace_app_id_marketplace_apps_id_fk" FOREIGN KEY ("marketplace_app_id") REFERENCES "public"."marketplace_apps"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "applications_local_client_id_idx" ON "applications" USING btree ("client_id") WHERE marketplace_app_id is null;
CREATE UNIQUE INDEX "applications_portal_client_id_idx" ON "applications" USING btree ("portal_id","client_id");
```

Check these rules:
- The `DROP CONSTRAINT "applications_client_id_unique"` statement comes before both `CREATE UNIQUE INDEX` statements. If not, move it up by hand.
- The file has no `UPDATE`, `INSERT` or `DELETE` statement (no data change).
- If drizzle-kit asks an interactive question (rename or create), answer "create".

- **Step 7: Run the migration test and the existing suite**

Run: `npx vitest run test/integration/migration.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm test`
Expected: PASS. Existing tests still pass. The local `client_id` uniqueness now comes from the partial index.

- **Step 8: Commit**

```bash
npx prettier --write src/schema.ts src/tokens.ts test/helpers.ts test/integration/migration.test.ts
git add src/schema.ts src/tokens.ts test/helpers.ts test/integration/migration.test.ts drizzle/
git commit -F - <<'EOF'
feat(db): add marketplace_apps catalog and install rows in applications

Add the marketplace_apps table and applications.marketplace_app_id.
Make applications.secret_hash nullable and replace the global unique
client_id with a partial unique index for local rows and a unique index
on (portal_id, client_id).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Catalog database functions (tasks.md 2.3, cascade part)

<!-- comet-task-ref:fd8cc69c-aa54-4d43-b1fd-cc12f7c358d6 -->

**Files:**
- Create: `src/marketplace.ts`
- Modify: `test/helpers.ts` (add `CATALOG_APP`, `addCatalogEntry`)
- Test: `test/integration/marketplace-catalog.test.ts` (create)

**Interfaces:**
- Consumes: `marketplaceApps`, `applications`, `tokenPairs` from `src/schema.ts` (Task 1).
- Produces (`src/marketplace.ts`):
  - `type CatalogEntry = { clientId: string; secretHash: string; title: string; scope: string }`
  - `upsertCatalogEntry(db: Db, entry: CatalogEntry): Promise<void>`
  - `listCatalog(db: Db): Promise<{ clientId: string; title: string; scope: string }[]>` (sorted by `clientId`)
  - `removeCatalogEntry(db: Db, clientId: string): Promise<boolean>` (`false`: no entry)
- Produces (`test/helpers.ts`):
  - `CATALOG_APP = { clientId: 'app.a1.1', secret: 'partner-secret-123', title: 'Partner app', scope: 'crm,user' }`
  - `addCatalogEntry(db: Db, entry?: { clientId: string; secret: string; title: string; scope: string }): Promise<void>`

- **Step 1: Add the test helpers**

In `test/helpers.ts`, add the imports `import { upsertCatalogEntry } from '../src/marketplace.js';` and `import { sha256 } from '../src/tokens.js';` (merge with the existing `type TokenResponse` import from `../src/tokens.js`). Then add:

```ts
export const CATALOG_APP = {
  clientId: 'app.a1.1',
  secret: 'partner-secret-123',
  title: 'Partner app',
  scope: 'crm,user',
} as const;

export async function addCatalogEntry(
  db: Db,
  entry: { clientId: string; secret: string; title: string; scope: string } = CATALOG_APP,
): Promise<void> {
  await upsertCatalogEntry(db, {
    clientId: entry.clientId,
    secretHash: sha256(entry.secret),
    title: entry.title,
    scope: entry.scope,
  });
}
```

- **Step 2: Write the failing tests**

Create `test/integration/marketplace-catalog.test.ts`:

```ts
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
```

- **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/integration/marketplace-catalog.test.ts`
Expected: FAIL. `Cannot find module '../src/marketplace.js'`.

- **Step 4: Implement `src/marketplace.ts`**

```ts
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
```

- **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/integration/marketplace-catalog.test.ts`
Expected: PASS (1 test).

- **Step 6: Commit**

```bash
npx prettier --write src/marketplace.ts test/helpers.ts test/integration/marketplace-catalog.test.ts
git add src/marketplace.ts test/helpers.ts test/integration/marketplace-catalog.test.ts
git commit -F - <<'EOF'
feat(marketplace): add catalog database functions

upsertCatalogEntry, listCatalog and removeCatalogEntry. Removal deletes
the installs and their tokens by cascade.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Catalog CLI commands (tasks.md 2.1, 2.2, 2.3)

<!-- comet-task-ref:e6a01415-e645-4e47-8fab-eb63bc44125f --> <!-- comet-task-ref:a2f4bacb-e0f5-4328-8389-1cb2a60e0d14 --> <!-- comet-task-ref:fd8cc69c-aa54-4d43-b1fd-cc12f7c358d6 -->

**Files:**
- Modify: `src/cli.ts`
- Test: `test/integration/admin-cli.test.ts` (append tests; reuse `runCli`)

**Interfaces:**
- Consumes: `upsertCatalogEntry`, `listCatalog`, `removeCatalogEntry` (Task 2); `sha256`, `normalizeScope` from `src/tokens.ts`.
- Produces: CLI commands
  - `marketplace add --client-id <id> --title <title> --scope <scope> [--secret-stdin]` → stdout `Catalog entry "<id>" saved.`, exit 0
  - `marketplace list` → one line per entry: `<client_id>\t<title>\t<scope>`, exit 0
  - `marketplace remove --client-id <id>` → stdout `Removed`, exit 0; unknown id → exit 1

- **Step 1: Write the failing CLI tests**

Append to `test/integration/admin-cli.test.ts`. Add `marketplaceApps` to the schema import and `sha256` from `../../src/tokens.js`.

```ts
const SECRET = 'partner-secret-123';
const ADD = [
  'marketplace',
  'add',
  '--client-id',
  'app.a1.1',
  '--title',
  'Partner app',
  '--scope',
  'crm, user',
  '--secret-stdin',
];

it(
  'marketplace add stores only the hash of the secret',
  { timeout: 20_000 },
  async () => {
    const res = await runCli(ADD, `${SECRET}\n`);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('Catalog entry "app.a1.1" saved.');
    expect(res.stdout + res.stderr).not.toContain(SECRET);
    const [row] = await db.select().from(marketplaceApps);
    expect(row).toMatchObject({ clientId: 'app.a1.1', title: 'Partner app', scope: 'crm,user' });
    expect(row.secretHash).toBe(sha256(SECRET));
  },
);

it('marketplace list shows no secret and no hash', { timeout: 30_000 }, async () => {
  await runCli(ADD, `${SECRET}\n`);
  const res = await runCli(['marketplace', 'list']);
  expect(res.code).toBe(0);
  expect(res.stdout).toBe('app.a1.1\tPartner app\tcrm,user\n');
  expect(res.stdout + res.stderr).not.toContain(SECRET);
  expect(res.stdout + res.stderr).not.toContain(sha256(SECRET));
});

it('marketplace remove deletes the entry', { timeout: 30_000 }, async () => {
  await runCli(ADD, `${SECRET}\n`);
  const res = await runCli(['marketplace', 'remove', '--client-id', 'app.a1.1']);
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe('Removed');
  expect(await db.$count(marketplaceApps)).toBe(0);
});

it('marketplace remove of an unknown entry exits with 1', { timeout: 20_000 }, async () => {
  const res = await runCli(['marketplace', 'remove', '--client-id', 'app.none.1']);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('app.none.1');
});

it.each([
  { name: 'an empty secret', args: ADD, stdin: '\n' },
  {
    name: 'no --title',
    args: ['marketplace', 'add', '--client-id', 'app.a1.1', '--scope', 'crm', '--secret-stdin'],
    stdin: `${SECRET}\n`,
  },
  {
    name: 'a local client_id',
    args: [
      'marketplace', 'add', '--client-id', 'local.0123456789abcd.00000001',
      '--title', 'X', '--scope', 'crm', '--secret-stdin',
    ],
    stdin: `${SECRET}\n`,
  },
])('marketplace add refuses $name and changes nothing', { timeout: 20_000 }, async ({ args, stdin }) => {
  const res = await runCli(args, stdin);
  expect(res.code).toBe(1);
  expect(await db.$count(marketplaceApps)).toBe(0);
});

it(
  'marketplace add without a TTY and without --secret-stdin exits with 2',
  { timeout: 20_000 },
  async () => {
    const res = await runCli(ADD.filter((arg) => arg !== '--secret-stdin'));
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('--secret-stdin');
  },
);
```

- **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/integration/admin-cli.test.ts -t "marketplace"`
Expected: FAIL. `parseArgs` rejects the unknown option `--client-id` (exit 1 with the usage text).

- **Step 3: Implement the commands in `src/cli.ts`**

Add imports:

```ts
import type { Db } from './db.js';
import { listCatalog, removeCatalogEntry, upsertCatalogEntry } from './marketplace.js';
import { normalizeScope, sha256 } from './tokens.js';
```

Replace `USAGE` and `parseCli`:

```ts
const USAGE = [
  'Usage:',
  '  node dist/cli.js superuser set-password [--login <name>] [--password-stdin]',
  '  node dist/cli.js marketplace add --client-id <id> --title <title> --scope <scope> [--secret-stdin]',
  '  node dist/cli.js marketplace list',
  '  node dist/cli.js marketplace remove --client-id <id>',
  '',
  'marketplace add with a known client_id replaces its secret, title and scope.',
  'A new scope reaches an installed portal after its next application.install.',
  'marketplace remove deletes all installs of the application and all their tokens.',
  'The portal installs the application again when a user opens it after a new add.',
].join('\n');

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      login: { type: 'string' },
      'password-stdin': { type: 'boolean' },
      'client-id': { type: 'string' },
      title: { type: 'string' },
      scope: { type: 'string' },
      'secret-stdin': { type: 'boolean' },
    },
  });
}

type Values = ReturnType<typeof parseCli>['values'];
```

Add the shared database wrapper (moves the existing `try/catch/finally` out of `main`):

```ts
// Runs the migrations, then `run`. Never prints err.message or the stack: a Drizzle error holds
// the query parameters, and the parameters of a write hold a password hash or a secret hash.
async function withDb(run: (db: Db) => Promise<number>): Promise<number> {
  const { db, pool } = createDb(requiredEnv(process.env, 'DATABASE_URL'));
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    return await run(db);
  } catch (err) {
    const reason = ((err as Error).cause as Error | undefined)?.message ?? 'database error';
    console.error(`The database operation failed: ${reason}. Nothing changed.`);
    return 1;
  } finally {
    await pool.end();
  }
}
```

Move the current `superuser set-password` body into `setPassword` (behavior and messages unchanged):

```ts
async function setPassword(values: Values): Promise<number> {
  if (values.login !== undefined && !LOGIN_PATTERN.test(values.login)) {
    console.error('The login must have 3 to 64 characters: letters, digits, ".", "_" or "-".');
    return 1;
  }
  let password: string;
  if (values['password-stdin']) {
    password = await readStdinLine();
  } else {
    if (!process.stdin.isTTY) {
      console.error('No terminal is attached. Pipe the password and use --password-stdin.');
      return 2;
    }
    password = await promptHidden('New password: ');
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) {
      console.error('The passwords do not match. Nothing changed.');
      return 1;
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`The password must have at least ${MIN_PASSWORD_LENGTH} characters.`);
    return 1;
  }
  const passwordHash = await hashPassword(password);
  return withDb(async (db) => {
    const result = await setSuperuser(db, values.login, passwordHash);
    if (!result.saved) {
      console.error(`The login "${result.login}" belongs to a viewer. Nothing changed.`);
      return 1;
    }
    console.log(`Superuser "${result.login}" saved.`);
    return 0;
  });
}
```

Note: the original code computed `hashPassword` inside the `try`. Computing it before `withDb` is equivalent; the test `A failed write exits with 1 and never prints the password hash` still covers the safe message.

Add the marketplace commands:

```ts
async function marketplaceAdd(values: Values): Promise<number> {
  const clientId = values['client-id'];
  const { title } = values;
  if (!clientId || !title || !values.scope) {
    console.error(`marketplace add needs --client-id, --title and --scope.\n${USAGE}`);
    return 1;
  }
  // A local client_id on the same portal would collide with the install row.
  if (clientId.startsWith('local.')) {
    console.error('A Marketplace client_id cannot start with "local.". Nothing changed.');
    return 1;
  }
  let secret: string;
  if (values['secret-stdin']) {
    secret = await readStdinLine();
  } else {
    if (!process.stdin.isTTY) {
      console.error('No terminal is attached. Pipe the client secret and use --secret-stdin.');
      return 2;
    }
    secret = await promptHidden('Client secret: ');
    const again = await promptHidden('Repeat the client secret: ');
    if (secret !== again) {
      console.error('The secrets do not match. Nothing changed.');
      return 1;
    }
  }
  if (secret.length === 0) {
    console.error('The client secret is empty. Nothing changed.');
    return 1;
  }
  const scope = normalizeScope(values.scope);
  return withDb(async (db) => {
    await upsertCatalogEntry(db, { clientId, secretHash: sha256(secret), title, scope });
    console.log(`Catalog entry "${clientId}" saved.`);
    return 0;
  });
}

async function marketplaceList(): Promise<number> {
  return withDb(async (db) => {
    for (const entry of await listCatalog(db)) {
      console.log([entry.clientId, entry.title, entry.scope].join('\t'));
    }
    return 0;
  });
}

async function marketplaceRemove(values: Values): Promise<number> {
  const clientId = values['client-id'];
  if (!clientId) {
    console.error(`marketplace remove needs --client-id.\n${USAGE}`);
    return 1;
  }
  return withDb(async (db) => {
    if (!(await removeCatalogEntry(db, clientId))) {
      console.error(`There is no catalog entry "${clientId}". Nothing changed.`);
      return 1;
    }
    console.log('Removed');
    return 0;
  });
}
```

Replace `main` with the dispatcher:

```ts
async function main(argv: string[]): Promise<number> {
  let args: ReturnType<typeof parseCli>;
  try {
    args = parseCli(argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = args;
  switch (positionals.join(' ')) {
    case 'superuser set-password':
      return setPassword(values);
    case 'marketplace add':
      return marketplaceAdd(values);
    case 'marketplace list':
      return marketplaceList();
    case 'marketplace remove':
      return marketplaceRemove(values);
    default:
      console.error(USAGE);
      return 1;
  }
}
```

- **Step 4: Run the CLI tests**

Run: `npx vitest run test/integration/admin-cli.test.ts`
Expected: PASS. All new `marketplace` tests and all existing `superuser set-password` tests pass.

- **Step 5: Commit**

```bash
npx prettier --write src/cli.ts test/integration/admin-cli.test.ts
git add src/cli.ts test/integration/admin-cli.test.ts
git commit -F - <<'EOF'
feat(cli): add marketplace add, list and remove commands

The secret comes from a hidden prompt or from stdin with --secret-stdin.
The catalog stores only its sha256 hash. The list shows no secret and
no hash. Database errors use the existing safe message.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `application.install` and the two rejections (tasks.md 3.1, 3.2, 3.5 install part, 6.1)

<!-- comet-task-ref:9b113e7c-a90b-492d-b3ed-ad03dc8c3cb9 --> <!-- comet-task-ref:bfea99b8-5a4b-44aa-9a24-a2558b0a87fa --> <!-- comet-task-ref:c7275654-2b49-4ec5-a15e-7b9d484a4be1 --> <!-- comet-task-ref:300705f3-86eb-4ab2-9eb8-ad664d216ee0 -->

**Files:**
- Modify: `src/methods/applications.ts`
- Modify: `src/routes/rpc.ts` (`methods` map and import)
- Modify: `test/helpers.ts` (add `install`, `InstallResult`)
- Modify: `docs/logging.md` (reason list under the events table)
- Test: `test/integration/application-registry.test.ts`

**Interfaces:**
- Consumes: `marketplaceApps`, `applications` (Task 1); `addCatalogEntry`, `CATALOG_APP` (Task 2).
- Produces: `applicationInstall`, `applicationInstallSubscription` (exported `Method`s); RPC routes `/rest/application.install` and `/rest/application.install.subscription`.
- Produces (`test/helpers.ts`):
  - `type InstallResult = { client_id: string; version: number; status: string; scope: string[] }`
  - `install(app: FastifyInstance, portal: Credentials, clientId?: string, extra?: Record<string, unknown>): Promise<RpcResponse<InstallResult>>` (default `clientId` = `CATALOG_APP.clientId`, sends `VERSION: 3`)

- **Step 1: Add the `install` helper**

In `test/helpers.ts`:

```ts
export type InstallResult = { client_id: string; version: number; status: string; scope: string[] };

export async function install(
  app: FastifyInstance,
  portal: Credentials,
  clientId: string = CATALOG_APP.clientId,
  extra: Record<string, unknown> = {},
): Promise<RpcResponse<InstallResult>> {
  return rpc<InstallResult>(app, portal, 'application.install', {
    CLIENT_ID: clientId,
    VERSION: 3,
    ...extra,
  });
}
```

- **Step 2: Write the failing tests**

In `test/integration/application-registry.test.ts`, extend the helpers import with `addCatalogEntry`, `CATALOG_APP`, `install`, `PORTAL`. Add `marketplaceApps` to the schema import. Add `rpc` usage as already imported. Then append:

```ts
describe('application-registry: Marketplace install', () => {
  it('Install from the Marketplace', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    const res = await install(t.app, portal, 'app.a1.1', {
      CHECK_HASH: 'ignored',
      INSTALL_HASH: 'ignored',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      result: { client_id: 'app.a1.1', version: 3, status: 'F', scope: ['crm', 'user'] },
    });
    const [entry] = await t.db.select().from(marketplaceApps);
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clientId: 'app.a1.1',
      secretHash: null,
      title: 'Partner app',
      redirectUri: '',
      scope: 'crm,user',
      marketplaceAppId: entry.id,
    });
  });

  it('Repeated install', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);
    const [before] = await t.db.select().from(applications);
    const token = await authorize(t.app, portal, 'app.a1.1');
    await addCatalogEntry(t.db, { ...CATALOG_APP, title: 'Renamed', scope: 'crm' });

    const again = await install(t.app, portal);

    expect(again.body.result).toEqual({
      client_id: 'app.a1.1',
      version: 3,
      status: 'F',
      scope: ['crm'],
    });
    const rows = await t.db.select().from(applications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before.id, title: 'Renamed', scope: 'crm' });
    const checked = await rpc(t.app, portal, 'rest.check', { TOKEN: token.access_token });
    expect(checked.status).toBe(200);
  });

  it('Entry serves all portals', async () => {
    await addCatalogEntry(t.db);
    const first = await registerPortal(t.app);
    const second = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    expect((await install(t.app, first)).status).toBe(200);
    expect((await install(t.app, second)).status).toBe(200);
    expect(await t.db.$count(applications)).toBe(2);
  });

  it('Application of another vendor', async () => {
    const portal = await registerPortal(t.app);
    const res = await install(t.app, portal, 'app.other.1');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'ERROR_OAUTH',
      error_description: 'Application is not in the PocketAuth24 catalog',
    });
    expect(await t.db.$count(applications)).toBe(0);
    expect(t.logs.find((l) => l.reason === 'client_id_not_in_catalog')).toMatchObject({
      msg: 'request_failed',
    });
  });

  it('Subscription install', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.install.subscription', {
      CLIENT_ID: 'app.a1.1',
      VERSION: 3,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'ERROR_OAUTH',
      error_description: 'Subscription applications are not supported',
    });
    expect(await t.db.$count(applications)).toBe(0);
    expect(t.logs.find((l) => l.reason === 'subscription_not_supported')).toMatchObject({
      msg: 'request_failed',
    });
  });
});
```

Note: `OTHER_PORTAL` and `authorize` are already imported in this file. `PORTAL` is not needed if unused; drop it from the import to keep lint green.

- **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/integration/application-registry.test.ts -t "Marketplace install"`
Expected: FAIL. The server answers `ERROR_METHOD_NOT_FOUND`.

- **Step 4: Implement the methods**

In `src/methods/applications.ts`, change the schema import to `import { applications, marketplaceApps } from '../schema.js';` and add:

```ts
type InstallBody = { CLIENT_ID: string; VERSION: string | number };

// The portal always sends VERSION. CHECK_HASH and INSTALL_HASH protect paid installs in the
// cloud; the catalog is the access control here, so the server ignores them.
const installSchema = {
  type: 'object',
  required: ['CLIENT_ID', 'VERSION'],
  properties: {
    CLIENT_ID: { type: 'string' },
    VERSION: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
  },
} as const;

export const applicationInstall = defineMethod<InstallBody>(installSchema, async (ctx, body) => {
  const [entry] = await ctx.db
    .select()
    .from(marketplaceApps)
    .where(eq(marketplaceApps.clientId, body.CLIENT_ID))
    .limit(1);
  if (!entry) {
    fail(
      'ERROR_OAUTH',
      'Application is not in the PocketAuth24 catalog',
      400,
      'client_id_not_in_catalog',
    );
  }
  // The upsert keeps the row id, so the tokens of an earlier install stay valid.
  await ctx.db
    .insert(applications)
    .values({
      portalId: ctx.portal.id,
      clientId: entry.clientId,
      secretHash: null,
      title: entry.title,
      redirectUri: '',
      scope: entry.scope,
      marketplaceAppId: entry.id,
    })
    .onConflictDoUpdate({
      target: [applications.portalId, applications.clientId],
      set: { title: entry.title, scope: entry.scope },
    });
  return {
    client_id: entry.clientId,
    version: Number(body.VERSION),
    status: 'F',
    scope: entry.scope.split(',').filter(Boolean),
  };
});

export const applicationInstallSubscription = defineMethod<Record<string, unknown>>(
  { type: 'object' },
  async () =>
    fail(
      'ERROR_OAUTH',
      'Subscription applications are not supported',
      400,
      'subscription_not_supported',
    ),
);
```

In `src/routes/rpc.ts`, import `applicationInstall` and `applicationInstallSubscription` from `../methods/applications.js` and add to `methods`:

```ts
  'application.install': applicationInstall,
  'application.install.subscription': applicationInstallSubscription,
```

- **Step 5: Add the reasons to `docs/logging.md` (tasks.md 6.1)**

In the paragraph after the events table that starts "Some error responses have no description", the reasons describe error responses without a description. The two new reasons have a description, so add a new paragraph after it:

```markdown
Some causes share one client-visible error code. For `ERROR_OAUTH` from the install methods,
`reason` is `client_id_not_in_catalog` (`application.install` for a `client_id` that is not in
the Marketplace catalog) or `subscription_not_supported` (`application.install.subscription`).
```

- **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/integration/application-registry.test.ts`
Expected: PASS. The new tests and all existing tests pass.

- **Step 7: Commit**

```bash
npx prettier --write src/methods/applications.ts src/routes/rpc.ts test/helpers.ts test/integration/application-registry.test.ts docs/logging.md
git add src/methods/applications.ts src/routes/rpc.ts test/helpers.ts test/integration/application-registry.test.ts docs/logging.md
git commit -F - <<'EOF'
feat(rpc): add application.install for catalog applications

Install a catalog application for the calling portal with an upsert on
(portal_id, client_id). Reject a client_id outside the catalog and
application.install.subscription with ERROR_OAUTH and the log reasons
client_id_not_in_catalog and subscription_not_supported.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: `application.uninstall` and local-only update and delete (tasks.md 3.3, 3.4, 3.5 rest)

<!-- comet-task-ref:41a50a05-5bc2-47ce-928a-702d019ea4d2 --> <!-- comet-task-ref:d7735ad3-d6b5-4dce-be4f-51655c799cde --> <!-- comet-task-ref:c7275654-2b49-4ec5-a15e-7b9d484a4be1 -->

**Files:**
- Modify: `src/methods/applications.ts` (`applicationUpdate`, `applicationDelete`, new `applicationUninstall`)
- Modify: `src/routes/rpc.ts`
- Test: `test/integration/application-registry.test.ts`

**Interfaces:**
- Consumes: `install`, `addCatalogEntry`, `CATALOG_APP` (Tasks 2, 4).
- Produces: `applicationUninstall` (`Method`); RPC route `/rest/application.uninstall`.

- **Step 1: Write the failing tests**

Append to `test/integration/application-registry.test.ts`:

```ts
describe('application-registry: Marketplace uninstall', () => {
  it('Uninstall removes tokens', async () => {
    await addCatalogEntry(t.db);
    const first = await registerPortal(t.app);
    const second = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    await install(t.app, first);
    await install(t.app, second);
    const firstToken = await authorize(t.app, first, 'app.a1.1');
    const secondToken = await authorize(t.app, second, 'app.a1.1');

    const res = await rpc(t.app, first, 'application.uninstall', { CLIENT_ID: 'app.a1.1' });

    expect(res.body).toEqual({ result: true });
    const checked = await rpc(t.app, first, 'rest.check', { TOKEN: firstToken.access_token });
    expect(checked.body.error).toBe('invalid_token');
    const renewed = await tokenRequest(t.app, 'POST', {
      grant_type: 'refresh_token',
      client_id: 'app.a1.1',
      client_secret: CATALOG_APP.secret,
      refresh_token: firstToken.refresh_token,
    });
    expect(renewed.statusCode).toBe(400);
    const other = await rpc(t.app, second, 'rest.check', { TOKEN: secondToken.access_token });
    expect(other.status).toBe(200);
    expect(await t.db.$count(marketplaceApps)).toBe(1);
  });

  it('Uninstall of a missing install returns true', async () => {
    const portal = await registerPortal(t.app);
    const res = await rpc(t.app, portal, 'application.uninstall', { CLIENT_ID: 'app.a1.1' });
    expect(res.body).toEqual({ result: true });
  });

  it('Uninstall does not delete a local application', async () => {
    const portal = await registerPortal(t.app);
    const local = await addApp(t.app, portal);
    const res = await rpc(t.app, portal, 'application.uninstall', { CLIENT_ID: local.client_id });
    expect(res.body).toEqual({ result: true });
    expect(await t.db.$count(applications)).toBe(1);
  });

  it.each(['application.update', 'application.delete'])(
    '%s does not change a Marketplace install',
    async (method) => {
      await addCatalogEntry(t.db);
      const portal = await registerPortal(t.app);
      await install(t.app, portal);
      const res = await rpc(t.app, portal, method, { CLIENT_ID: 'app.a1.1', TITLE: 'Changed' });
      expect(res.body).toEqual({ error: 'ERROR_OAUTH', error_description: 'Application not found' });
      const [row] = await t.db.select().from(applications);
      expect(row).toMatchObject({ clientId: 'app.a1.1', title: 'Partner app' });
    },
  );
});
```

Note: the existing "Foreign application" test shows the exact error body of `Application not found`. If it uses a different shape, use that shape here.

- **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/integration/application-registry.test.ts -t "Marketplace uninstall"`
Expected: FAIL. `application.uninstall` answers `ERROR_METHOD_NOT_FOUND`; `application.update` and `application.delete` change the install row.

- **Step 3: Implement**

In `src/methods/applications.ts`, change the drizzle import to `import { and, eq, isNotNull, isNull } from 'drizzle-orm';`.

In `applicationUpdate` and `applicationDelete`, replace the `where` with:

```ts
    .where(
      and(
        eq(applications.clientId, body.CLIENT_ID),
        eq(applications.portalId, ctx.portal.id),
        // Local applications only: a Marketplace install changes through application.install.
        isNull(applications.marketplaceAppId),
      ),
    )
```

Add:

```ts
// The portal calls uninstall also when the install never reached the server, so a missing row
// is not an error. token_pairs rows go with the install (ON DELETE CASCADE).
export const applicationUninstall = defineMethod<DeleteBody>(deleteSchema, async (ctx, body) => {
  await ctx.db
    .delete(applications)
    .where(
      and(
        eq(applications.portalId, ctx.portal.id),
        eq(applications.clientId, body.CLIENT_ID),
        isNotNull(applications.marketplaceAppId),
      ),
    );
  return true;
});
```

In `src/routes/rpc.ts`, import `applicationUninstall` and add `'application.uninstall': applicationUninstall,` to `methods`.

- **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/integration/application-registry.test.ts`
Expected: PASS.

- **Step 5: Commit**

```bash
npx prettier --write src/methods/applications.ts src/routes/rpc.ts test/integration/application-registry.test.ts
git add src/methods/applications.ts src/routes/rpc.ts test/integration/application-registry.test.ts
git commit -F - <<'EOF'
feat(rpc): add application.uninstall and limit update and delete to local apps

application.uninstall deletes the install of the calling portal and its
tokens, and returns true also when there is no install.
application.update and application.delete no longer change install rows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Status `F` for install rows (tasks.md 4.1, 4.3 status and event parts)

<!-- comet-task-ref:1dc56066-0f9c-47ab-88b1-04d4f483d53c --> <!-- comet-task-ref:88c99449-ac67-4781-94fd-eed36c4c6a03 -->

**Files:**
- Modify: `src/tokens.ts` (`TokenResponse`, `tokenResponse`, `issuePair`, `CheckResult`, `check`)
- Test: `test/integration/token-service.test.ts`, `test/integration/event-delivery.test.ts`

**Interfaces:**
- Consumes: `install`, `addCatalogEntry` (Tasks 2, 4).
- Produces (`src/tokens.ts`):
  - `type AppStatus = 'L' | 'F'`
  - `appStatus(app: Pick<Application, 'marketplaceAppId'>): AppStatus`
  - `tokenResponse(config, portal, pair, status: AppStatus): TokenResponse`
  - `TokenResponse.status: AppStatus`, `CheckResult.status: AppStatus`

- **Step 1: Write the failing tests**

In `test/integration/token-service.test.ts`, add `addCatalogEntry` and `install` to the helpers import, then add inside the `describe('token-service', ...)` block:

```ts
  it('Status of a Marketplace application', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);

    const token = await authorize(t.app, portal, 'app.a1.1');
    const checked = await rpc<{ status: string; client_id: string }>(t.app, portal, 'rest.check', {
      TOKEN: token.access_token,
    });

    expect(token.status).toBe('F');
    expect(checked.body.result).toMatchObject({ client_id: 'app.a1.1', status: 'F' });
  });
```

In `test/integration/event-delivery.test.ts`, add `addCatalogEntry` and `install` to the helpers import, then add inside `describe('event-delivery', ...)`:

```ts
  it('Install event reaches a Marketplace install', async () => {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);
    const handler = await startHandler();
    try {
      await rpc(t.app, portal, 'rest.event.call', {
        QUERY: [
          eventItem(handler.url, {
            client_id: 'app.a1.1',
            event: 'ONAPPINSTALL',
            auth: { LOCAL_USER: '1', application_token: 'apptoken123' },
            additional: { sendAuth: '1', sendRefreshToken: '1' },
          }),
        ],
      });

      await vi.waitFor(() => {
        expect(handler.requests).toHaveLength(1);
      });
      const auth = handler.requests[0].auth as Record<string, unknown>;
      expect(auth).toMatchObject({
        domain: 'portal.test',
        server_endpoint: 'https://auth.test/rest/',
        member_id: md5(portal.client_id),
        user_id: '1',
        scope: 'crm,user',
        status: 'F',
      });
      expect(auth.access_token).toMatch(/^[0-9a-f]{64}$/);
      expect(auth.refresh_token).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await handler.close();
    }
  });
```

- **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/integration/token-service.test.ts test/integration/event-delivery.test.ts -t "Marketplace"`
Expected: FAIL. `status` is `'L'`, expected `'F'`.

- **Step 3: Implement**

In `src/tokens.ts`:

```ts
export type AppStatus = 'L' | 'F';

// F (free) for a Marketplace install, L for a local application. No paid statuses.
export function appStatus(app: Pick<Application, 'marketplaceAppId'>): AppStatus {
  return app.marketplaceAppId === null ? 'L' : 'F';
}
```

- In `TokenResponse`, change `status: 'L';` to `status: AppStatus;`.
- Give `tokenResponse` a fourth parameter `status: AppStatus` and return `status` instead of `'L'`.
- At the end of `issuePair`, pass `appStatus(app)` as the fourth argument of `tokenResponse(...)`.
- In `CheckResult`, change `status: 'L';` to `status: AppStatus;`.
- In `check`, change the select to:

```ts
    .select({
      pair: tokenPairs,
      clientId: applications.clientId,
      marketplaceAppId: applications.marketplaceAppId,
    })
```

  and return `status: appStatus(row),` instead of `status: 'L',`.

The callers of `issuePair` (`rest.authorize`, event auth in `src/methods/events.ts`, `refresh`) already pass the `applications` row. They need no change.

- **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/integration/token-service.test.ts test/integration/event-delivery.test.ts test/contract/cloud-shapes.test.ts`
Expected: PASS. The existing `status: 'L'` assertions for local apps still pass.

- **Step 5: Commit**

```bash
npx prettier --write src/tokens.ts test/integration/token-service.test.ts test/integration/event-delivery.test.ts
git add src/tokens.ts test/integration/token-service.test.ts test/integration/event-delivery.test.ts
git commit -F - <<'EOF'
feat(tokens): return status F for Marketplace installs

rest.authorize, rest.check and event auth return status F when the
application row is a Marketplace install and L for a local application.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Renewal with the catalog secret (tasks.md 4.2, 4.3 renewal part)

<!-- comet-task-ref:b2dbc691-6b55-474e-af7c-0aac4a67e6ed --> <!-- comet-task-ref:88c99449-ac67-4781-94fd-eed36c4c6a03 -->

**Files:**
- Modify: `src/tokens.ts` (`refresh`)
- Test: `test/integration/token-service.test.ts`

**Interfaces:**
- Consumes: `marketplaceApps` (Task 1); `install`, `addCatalogEntry`, `CATALOG_APP` (Tasks 2, 4).
- Produces: `refresh` accepts the catalog `client_secret` for an install row. No signature change.

- **Step 1: Write the failing tests**

In `test/integration/token-service.test.ts`, add `CATALOG_APP` and `OTHER_PORTAL` to the helpers import (if not there yet), then add inside `describe('token-service', ...)`:

```ts
  async function installed(): Promise<{ portal: Credentials; token: TokenResponse }> {
    await addCatalogEntry(t.db);
    const portal = await registerPortal(t.app);
    await install(t.app, portal);
    const token = await authorize(t.app, portal, 'app.a1.1');
    return { portal, token };
  }

  function catalogRefresh(refreshToken: string, secret: string = CATALOG_APP.secret) {
    return {
      grant_type: 'refresh_token',
      client_id: 'app.a1.1',
      client_secret: secret,
      refresh_token: refreshToken,
    };
  }

  it('Partner backend renews a token', async () => {
    const { portal, token } = await installed();
    const other = await registerPortal(t.app, `${OTHER_PORTAL}/`);
    await install(t.app, other);

    const res = await tokenRequest(t.app, 'POST', catalogRefresh(token.refresh_token));

    expect(res.statusCode).toBe(200);
    const renewed = res.json<TokenResponse & { user_id: number }>();
    expect(renewed).toMatchObject({ user_id: 5, status: 'F' });
    const onA = await rpc<{ scope: string }>(t.app, portal, 'rest.check', {
      TOKEN: renewed.access_token,
    });
    expect(onA.body.result?.scope).toBe('crm,user');
    // A refresh token of portal A never gives tokens for portal B.
    const onB = await rpc(t.app, other, 'rest.check', { TOKEN: renewed.access_token });
    expect(onB.body.error).toBe('invalid_token');
  });

  it('Rotate the secret', async () => {
    const { token } = await installed();
    await addCatalogEntry(t.db, { ...CATALOG_APP, secret: 'rotated-secret-456' });
    t.logs.length = 0;

    const old = await tokenRequest(t.app, 'POST', catalogRefresh(token.refresh_token));
    const fresh = await tokenRequest(
      t.app,
      'POST',
      catalogRefresh(token.refresh_token, 'rotated-secret-456'),
    );

    expect(old.statusCode).toBe(400);
    expect(old.json<{ error: string }>().error).toBe('invalid_client');
    expect(t.logs.find((l) => l.msg === 'request_failed')).toMatchObject({
      reason: 'client_secret_mismatch',
    });
    expect(fresh.statusCode).toBe(200);
  });
```

`Credentials`, `TokenResponse`, `addApp`, `refreshParams` already exist in this file. Import any missing name from `../helpers.js` or `../../src/tokens.js`.

- **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/integration/token-service.test.ts -t "renews|Rotate"`
Expected: FAIL. The renewal answers 400 `invalid_client`, because the install row has no secret hash.

- **Step 3: Implement the catalog secret check**

In `src/tokens.ts`, add `marketplaceApps` to the schema import. In `refresh`, replace the select and the secret check:

```ts
  const [row] = await db
    .select({
      pair: tokenPairs,
      app: applications,
      portal: portals,
      catalogSecretHash: marketplaceApps.secretHash,
    })
    .from(tokenPairs)
    .innerJoin(applications, eq(tokenPairs.applicationId, applications.id))
    .innerJoin(portals, eq(applications.portalId, portals.id))
    .leftJoin(marketplaceApps, eq(applications.marketplaceAppId, marketplaceApps.id))
    .where(eq(tokenPairs.refreshHash, sha256(input.refreshToken)))
    .limit(1);
```

```ts
  // A Marketplace install has no secret of its own: the catalog secret applies to all portals.
  // Both null means a broken row: reject it, never accept it.
  const secretHash = row.catalogSecretHash ?? row.app.secretHash;
  if (secretHash === null || !hashMatches(secretHash, input.clientSecret)) {
    fail('invalid_client', '', 400, 'client_secret_mismatch');
  }
```

The `client_id` check (`row.app.clientId !== input.clientId`) stays as it is. For an install row, `applications.client_id` equals the catalog `client_id`.

- **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/integration/token-service.test.ts test/contract/cloud-shapes.test.ts`
Expected: PASS.

- **Step 5: Commit**

```bash
npx prettier --write src/tokens.ts test/integration/token-service.test.ts
git add src/tokens.ts test/integration/token-service.test.ts
git commit -F - <<'EOF'
feat(tokens): renew Marketplace tokens with the catalog secret

refresh left-joins marketplace_apps and checks the catalog secret hash
before the secret hash of the application row. A rotation in the catalog
applies to all installs at once.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Install rows in the admin panel (tasks.md 5.1)

<!-- comet-task-ref:e757a5c9-3fda-4de9-a1d8-57c368c032b3 -->

**Files:**
- Test: `test/integration/admin-data.test.ts`
- Modify (only if the test fails): `src/admin/dataRoutes.ts`

**Interfaces:**
- Consumes: `addCatalogEntry`, `install`, `CATALOG_APP` (Tasks 2, 4).

- **Step 1: Write the test**

In `test/integration/admin-data.test.ts`, add `addCatalogEntry`, `CATALOG_APP` and `install` to the helpers import, `marketplaceApps` to the schema import, and add:

```ts
it('GET /applications shows a Marketplace install and no secret or hash', async () => {
  await addCatalogEntry(t.db);
  const portal = await registerPortal(t.app);
  await install(t.app, portal);
  await authorize(t.app, portal, 'app.a1.1');

  const apps = await list('applications');
  const tokens = await list('tokens');

  expect(apps.body.total).toBe(1);
  expect(apps.body.rows[0]).toMatchObject({
    portal: PORTAL,
    clientId: 'app.a1.1',
    title: 'Partner app',
    redirectUri: '',
    scope: 'crm,user',
  });
  expect(tokens.body.rows[0]).toMatchObject({ clientId: 'app.a1.1', application: 'Partner app' });
  const [entry] = await t.db.select({ secretHash: marketplaceApps.secretHash }).from(marketplaceApps);
  for (const res of [apps, tokens]) {
    expect(res.text).not.toMatch(/secret/i);
    expect(res.text).not.toContain(entry.secretHash);
    expect(res.text).not.toContain(CATALOG_APP.secret);
  }
});
```

- **Step 2: Run the test**

Run: `npx vitest run test/integration/admin-data.test.ts -t "Marketplace install"`
Expected: PASS without a code change. The applications and tokens views select named columns and join `portals` with an inner join, so install rows appear and no hash is selected.
If it fails, change only `APPLICATION_COLUMNS` or `TOKEN_COLUMNS` in `src/admin/dataRoutes.ts` so that the install row shows and no secret column is selected. Do not add write routes.

- **Step 3: Commit**

```bash
npx prettier --write test/integration/admin-data.test.ts
git add test/integration/admin-data.test.ts
git commit -F - <<'EOF'
test(admin): cover Marketplace installs in the applications view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Partner section in the deployment guide (tasks.md 6.2)

<!-- comet-task-ref:0078f3e6-29e7-4ebf-acae-e06a7ddd575d -->

**Files:**
- Modify: `docs/deployment.md` (end of section 6 "Re-create local applications"; new section 6b after section 7 or a new `## 7b.` — keep the numbering style of the file)

- **Step 1: Change the last sentence of section 6**

Replace:

```markdown
Marketplace applications are not supported in a closed network.
```

with:

```markdown
Marketplace applications of other vendors do not work with PocketAuth24. Your own Marketplace
application can work: see [7b. Marketplace applications of a partner](#7b-marketplace-applications-of-a-partner).
```

- **Step 2: Add the section after section 7a**

```markdown
## 7b. Marketplace applications of a partner

A partner can serve its own Marketplace application through PocketAuth24. The partner knows the
`client_id` and the `client_secret` of the application. Applications of other vendors do not
work, because their secrets are only in the cloud.

1. Add the application to the catalog. The command asks for the `client_secret` twice and shows
   nothing on the screen:

   ```bash
   docker compose exec app node dist/cli.js marketplace add --client-id app.a1.1 --title "Partner app" --scope crm,user
   ```

   For a script, send the secret on standard input:

   ```bash
   printf '%s\n' "$CLIENT_SECRET" | docker compose exec -T app node dist/cli.js marketplace add --client-id app.a1.1 --title "Partner app" --scope crm,user --secret-stdin
   ```

2. Install the application on the portal from the Marketplace as usual. The portal calls
   `application.install`, and PocketAuth24 records the install with status `F`.
3. Configure the application backend to renew tokens at `server_endpoint` from the token answer or
   from the event `auth` block. Do not use `oauth.bitrix.info`: the cloud does not know these
   tokens and rejects them.

Other commands:

- `marketplace list` shows the `client_id`, the title and the scope of each entry. It never shows
  the secret or its hash.
- `marketplace add` with a known `client_id` replaces the secret, the title and the scope. A new
  secret applies to all portals at once. A new scope applies to a portal after its next
  `application.install`.
- `marketplace remove --client-id app.a1.1` deletes the entry, all its installs and all their
  tokens. If you remove an entry by mistake, add it again. Each portal installs the application
  again when a user opens it. The old tokens do not come back.

A portal that calls `application.install` for a `client_id` outside the catalog gets the error
`Application is not in the PocketAuth24 catalog`. Subscription applications are not supported.
```

Check that the code fences inside the list render (indent them by three spaces as above).

- **Step 3: Check the format**

Run: `npx prettier --check docs/deployment.md`
Expected: PASS (run `npx prettier --write docs/deployment.md` if not).

- **Step 4: Commit**

```bash
git add docs/deployment.md
git commit -F - <<'EOF'
docs(deployment): describe Marketplace applications of a partner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: README and five translations (tasks.md 6.3)

<!-- comet-task-ref:6e39698c-d5ee-4ffa-a8af-93ecdbf38a22 -->

**Files:**
- Modify: `README.md`, `README.de.md`, `README.it.md`, `README.es.md`, `README.pt.md`, `README.ru.md`

The English `README.md` is the source. All six files change in one commit (CLAUDE.md rule 3).

- **Step 1: Load the `sepia-refactor` skill**

Use the Skill tool: `sepia-refactor`. Apply it only to the prose below. Rule 2 (STE) still applies. Sepia must not add facts: take every fact from the Design Doc and `docs/deployment.md` section 7b.

- **Step 2: Change the English text in `README.md`**

Make these minimal edits. The text below is the draft input for `sepia-refactor`:

1. "Why", the paragraph "It is useful with internet access too", the sentence that starts "The cost:". New meaning: after the switch, the portal stops using the cloud OAuth server, so Marketplace applications of other vendors stop working. A partner's own Marketplace application keeps working if the partner adds it to the PocketAuth24 catalog. Keep the advice: use this setup only for portals that need local applications and the partner's own applications.
2. "Benefits", the bullet "Your uptime, not someone else's": replace "Marketplace apps need the cloud and stop working after the switch." with the same meaning as item 1 in one sentence.
3. "Features available today" table: add one row after **Local applications**:
   `| **Your own Marketplace application** | Add your Marketplace application to the catalog with the CLI. The portal installs it from the Marketplace as usual, and PocketAuth24 issues and renews its tokens with status `F`. The catalog stores only the hash of the `client_secret`. |`
4. "Limitations", the bullet "Local applications only.": change to
   `- **Local applications and your own Marketplace applications only.** Marketplace applications of other vendors do not work, because their secrets live in the cloud. Paid, trial and subscription applications are not supported. The backend of your application must renew tokens at `server_endpoint`, not at `oauth.bitrix.info`.`
5. "Limitations", the bullet "Not supported: ... install and uninstall handling on the server side": check what it means. If it refers to the `ONAPPINSTALL` handler of a local app, keep it. If it refers to `application.install`/`application.uninstall`, remove those words, because they now work.
6. Link the new feature row or limit to `docs/deployment.md#7b-marketplace-applications-of-a-partner` if the README links other deployment sections the same way.

Do not change code blocks, commands or configuration keys. Run Sepia on the changed sentences only.

- **Step 3: Apply the same change to the five translations**

For each of `README.de.md`, `README.it.md`, `README.es.md`, `README.pt.md`, `README.ru.md`:
- Make the same edits in the same places: the same sentences in "Why" and "Benefits", the same new table row in the same position, the same limits.
- Translate the prose and the table text from the final English text. Do not translate `client_secret`, `server_endpoint`, `oauth.bitrix.info`, `F`, CLI commands or product names.
- Keep the structure identical: the same sections in the same order, the same badges, the same code blocks.
- Keep the language switcher under the title unchanged.
- If you link a heading, fix the in-page anchor to match the translated heading. The link to `docs/deployment.md` stays as it is (English only).

- **Step 4: Check the structure**

Run (Git Bash):

```bash
for f in README.md README.de.md README.it.md README.es.md README.pt.md README.ru.md; do echo "$f $(grep -c '^#' "$f") $(grep -c '^|' "$f")"; done
```

Expected: all six files have the same count of headings and the same count of table lines.

Run: `npx prettier --check README*.md`
Expected: PASS.

- **Step 5: Commit**

```bash
git add README.md README.de.md README.it.md README.es.md README.pt.md README.ru.md
git commit -F - <<'EOF'
docs(readme): describe support for a partner's own Marketplace application

Update Why, Benefits, Features and Limitations in README.md and in the
five translations.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Verification (tasks.md 7.1, 7.2)

<!-- comet-task-ref:d8991241-d9fb-4327-ad08-bbedca6d51ce --> <!-- comet-task-ref:5c67b688-1af8-488d-9021-90e2e9348240 -->

**Files:** none changed, unless a check fails.

- **Step 1: Run lint, type check, build and the full suite (tasks.md 7.1)**

Run each command and record the result for the verify report:

```bash
npm run lint
npm run typecheck
npm run build
npm test
```

Expected: all four exit with code 0. The contract tests in `test/contract/cloud-shapes.test.ts` pass without change.
If a check fails, fix the cause in the task that owns the file, run the check again, and commit the fix with a conventional message (`fix(...)`) and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

- **Step 2: Live install on a test portal (tasks.md 7.2)**

This check needs the user: a local test portal that uses PocketAuth24 and a real Marketplace application of the partner with its `client_id` and `client_secret`.

- If the user does not give a test portal, do not try this check. Record it in the verify report as "not checked: no test portal with a partner Marketplace application was available". State the risk from the change `design.md`: the answer shape of `application.install` comes from the portal code, not from captured cloud traffic.
- If the user gives a test portal, follow these steps and record the result:
  1. Add the application to the catalog with `marketplace add`.
  2. Install the application from the Marketplace on the portal.
  3. Open the application. Make sure that it opens and that a REST call with its token works.
  4. Renew a token from the application backend at `server_endpoint`.
  5. Uninstall the application. Make sure that the old token fails `rest.check`.

- **Step 3: Check off `tasks.md`**

Mark each finished item in `docs/openspec/changes/marketplace-partner-apps/tasks.md` as `- [x]`. Leave 7.2 open if it was not checked, and give the reason in the verify report.

---

## Self-review notes

- Spec coverage: every tasks.md id (1.1 to 7.2) maps to a task above. Every scenario in the three delta specs has a test: Install from the Marketplace, Repeated install, Application of another vendor, Subscription install, Uninstall removes tokens, Foreign application (install row), Status sync (existing), Fields present (existing), Status of a Marketplace application, Partner backend renews a token, Entry serves all portals, Add an entry and Database leak (CLI test `marketplace add stores only the hash of the secret`), Rotate the secret, Remove an entry (cascade test in Task 2).
- Design ambiguities resolved in this plan (confirm in review):
  1. `VERSION` is "string or integer". `Number(VERSION)` gives `NaN` (JSON `null`) for a non-numeric string. The plan follows the Design Doc and does not add a pattern check.
  2. A catalog `client_id` that starts with `local.` could collide with a local row on `(portal_id, client_id)`, and the install upsert would then overwrite the local row's title and scope. The Design Doc assumes this cannot happen. The plan adds a one-line refusal in `marketplace add` (Task 3).
  3. tasks.md 2.3 asks for a cascade test before the RPC install exists. Task 2 seeds the install row and token pair directly in the database.
  4. tasks.md 6.1 is folded into Task 4, so the reasons and their documentation land in one commit (CLAUDE.md rule 5).

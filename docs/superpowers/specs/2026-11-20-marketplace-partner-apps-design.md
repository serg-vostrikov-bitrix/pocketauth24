---
comet_change: marketplace-partner-apps
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-20-marketplace-partner-apps
status: final
---

# Marketplace partner applications: technical design

The OpenSpec change `marketplace-partner-apps` is the source of the requirements. This document
gives the implementation detail. Decision numbers (D1 to D6) refer to the change `design.md`.

## 1. Schema (`src/schema.ts`)

```ts
export const marketplaceApps = pgTable('marketplace_apps', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  clientId: text('client_id').notNull().unique(),
  secretHash: text('secret_hash').notNull(),
  title: text('title').notNull(),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Changes to `applications`:

- `secretHash` becomes nullable. A local row always has a hash. An install row has null.
- New column `marketplaceAppId` (`bigint`, nullable, references `marketplace_apps.id`,
  `ON DELETE CASCADE`).
- Remove `.unique()` from `clientId`. Add two indexes:
  - `applications_local_client_id_idx`: unique on `client_id` `where marketplace_app_id is null`.
  - `applications_portal_client_id_idx`: unique on `(portal_id, client_id)`.

`Application` keeps its inferred type. Code that reads `secretHash` must handle null (only
`refresh`, see section 4).

Generate `drizzle/0004_marketplace_apps.sql` with `drizzle-kit generate`. Check that the file
drops the old unique constraint before it creates the indexes, and that it changes no data.

## 2. Status from the row kind (`src/tokens.ts`)

```ts
export type AppStatus = 'L' | 'F';
export function appStatus(app: Pick<Application, 'marketplaceAppId'>): AppStatus {
  return app.marketplaceAppId === null ? 'L' : 'F';
}
```

- `TokenResponse.status` and `CheckResult.status` change to `AppStatus`.
- `tokenResponse(config, portal, pair)` gets a fourth argument `status`. `issuePair` passes
  `appStatus(app)`. All three callers of `issuePair` (`rest.authorize`, event auth, `refresh`)
  already pass the `applications` row, so they need no change.
- `check` also selects `applications.marketplaceAppId` and returns `appStatus(row)`.

## 3. RPC methods (`src/methods/applications.ts`, `src/routes/rpc.ts`)

Register three methods in `methods`: `application.install`, `application.install.subscription`
and `application.uninstall`.

### 3.1 `application.install`

Body schema: `CLIENT_ID` (string, required), `VERSION` (string or integer, required; the portal
always sends it). Other fields
(`CHECK_HASH`, `INSTALL_HASH`) are allowed and ignored.

1. Read the catalog entry by `CLIENT_ID`. If there is none:
   `fail('ERROR_OAUTH', 'Application is not in the PocketAuth24 catalog', 400, 'client_id_not_in_catalog')`.
2. Insert into `applications` with `portalId`, `clientId`, `secretHash: null`, `title`,
   `redirectUri: ''`, `scope` and `marketplaceAppId` from the catalog.
   `onConflictDoUpdate` on `(portal_id, client_id)` sets `title` and `scope`. A local row cannot
   conflict, because local `client_id` values start with `local.` and Marketplace codes do not.
3. Return `{ client_id, version: Number(VERSION), status: 'F', scope: catalog.scope.split(',').filter(Boolean) }`.

The upsert keeps the row id, so the token pairs of a repeated install stay valid (D3).

### 3.2 `application.install.subscription`

Always
`fail('ERROR_OAUTH', 'Subscription applications are not supported', 400, 'subscription_not_supported')`.
Body schema: an object with no required fields. Thus, the portal gets this message and not a
schema error.

### 3.3 `application.uninstall`

Body schema: `CLIENT_ID` (string, required). Delete from `applications` where `portalId` is the
calling portal, `clientId` is `CLIENT_ID` and `marketplaceAppId` is not null. Return `true` also when
no row was deleted. Token pairs go by the existing cascade.

### 3.4 `application.update` and `application.delete`

Add `isNull(applications.marketplaceAppId)` to their `where`. An install row then gives the
existing `Application not found` error.

## 4. Renewal (`src/tokens.ts` `refresh`)

Add `leftJoin(marketplaceApps, eq(applications.marketplaceAppId, marketplaceApps.id))` and select
`catalogSecretHash: marketplaceApps.secretHash`. Check the secret against
`row.catalogSecretHash ?? row.app.secretHash`. If both are null, the row is broken. Reject it as
`client_secret_mismatch`, never accept it.

`hashMatches` stays as it is. The client_id check stays `row.app.clientId !== input.clientId`.
For an install row, `applications.client_id` equals the catalog `client_id`.

## 5. Catalog CLI (`src/marketplace.ts`, `src/cli.ts`)

`src/marketplace.ts` holds the database functions, so tests can call them without a process:

```ts
upsertCatalogEntry(db, { clientId, secretHash, title, scope }): Promise<void>
listCatalog(db): Promise<{ clientId: string; title: string; scope: string }[]>
removeCatalogEntry(db, clientId): Promise<boolean> // false: no entry
```

`upsertCatalogEntry` uses `onConflictDoUpdate` on `client_id` and sets `secretHash`, `title` and
`scope`. A changed `scope` applies to new installs and to new tokens of existing installs only
after the next `application.install`, because tokens take `applications.scope`. Document this
in the CLI help.

`src/cli.ts`:

- `USAGE` lists the new commands.
- `main` dispatches on the first two positionals: `superuser set-password`, `marketplace add`,
  `marketplace list`, `marketplace remove`. Move the current body into `setPassword(values)`.
- New options: `client-id`, `title`, `scope` (strings), `secret-stdin` (boolean).
- `marketplace add` requires `--client-id`, `--title` and `--scope`. The secret comes from
  `readStdinLine()` with `--secret-stdin`, or from `promptHidden` twice, as for the password. An
  empty secret is refused. `scope` goes through `normalizeScope`.
- `marketplace list` prints one tab-separated line for each entry: `client_id`, title, scope.
- `marketplace remove` prints `Removed` or exits with code 1 when there is no entry.
- All database errors use the existing safe message (no `err.message`, because query parameters
  can hold the secret hash).

## 6. Docs

- `docs/logging.md`: add `client_id_not_in_catalog` and `subscription_not_supported` to the reasons of `request_failed`.
- `docs/deployment.md`: a section "Marketplace applications of a partner". It covers the CLI
  commands, the renewal at `server_endpoint`, the effect of `marketplace remove` and the
  statement that other vendors' applications do not work.
- `README.md` and five translations: change the "Local applications only" limit and the
  Marketplace sentences in "Why" and "Benefits". Use `sepia-refactor` for the English text.

## 7. Test strategy

All tests are integration tests on the real test PostgreSQL. They use `test/helpers.ts`
(`registerPortal`, `rpc`, `t.logs`). Seed the catalog with `upsertCatalogEntry`.

| Area | Tests |
| --- | --- |
| Install | result shape with `VERSION` echo; repeated install keeps tokens; same `client_id` on two portals; not in catalog (error, no row, reason in `request_failed`); subscription |
| Uninstall | tokens fail after uninstall; other portal unaffected; missing install returns `true` |
| Update and delete | an install row gives `Application not found` |
| Tokens | `rest.authorize` and `rest.check` status `F` (local `L` is already covered); renewal with the catalog secret; rotation; wrong secret; refresh token of portal A gives a pair on portal A |
| Events | `ONAPPINSTALL` with `sendAuth` for an install row delivers tokens with status `F` |
| Catalog | remove cascades to installs and tokens (secret replacement is owned by the rotation test) |
| CLI | `marketplace add --secret-stdin` stores a hash that is not the secret, `list` shows no secret or hash, `remove` unknown id exits 1 (process tests as in `admin-cli.test.ts`) |
| Migration | migrations run on a database with a local application; the local application still works |

The existing contract tests (`test/contract/cloud-shapes.test.ts`) must still pass. They are not new tests.

## 8. Edge cases

- A portal sends `application.install` before the operator adds the entry: error. After the
  entry is added, the next app open retries the install (`AuthTokenFiller`).
- The operator removes and re-adds an entry: the installs are gone. The next app open on each
  portal installs again through the same retry. Old tokens do not come back.
- The partner backend still renews at `oauth.bitrix.info`: the cloud rejects the token. This is a
  partner configuration error. The deployment doc names it.

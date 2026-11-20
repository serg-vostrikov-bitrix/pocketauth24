## Why

A partner who publishes an application in the Bitrix24 Marketplace cannot use PocketAuth24 for
on-premise clients today. When a portal uses PocketAuth24, the portal sends `application.install`
for each Marketplace install, and the server answers `ERROR_METHOD_NOT_FOUND`. The install fails.
The partner knows the `client_id` and the `client_secret` of the application. Thus, the partner can
give them to its own PocketAuth24 and serve its own application without the cloud OAuth server.

## What Changes

- Add a catalog of Marketplace applications. The operator adds, changes, lists and removes catalog
  entries through the CLI only. An entry holds the `client_id`, the hash of the `client_secret`,
  the title and the scope.
- Implement `application.install` for a `client_id` in the catalog. The server records the install
  for the calling portal and answers with `client_id`, `version`, `status` = `F` and `scope`.
- Reject `application.install` for a `client_id` outside the catalog, and reject
  `application.install.subscription` for all applications. Use `ERROR_OAUTH` with a clear
  description and a log-only `reason` for each cause.
- Implement `application.uninstall`. The server removes the install of the calling portal and all
  its tokens.
- Issue, check and renew tokens for an installed Marketplace application with the same rules as
  for a local application. `status` is `F` for a Marketplace application and stays `L` for a
  local application.
- Allow one Marketplace `client_id` on many portals. Today `applications.client_id` is unique in
  the whole database.
- Deliver events, `ONAPPINSTALL` included, to the handler of an installed Marketplace application.
- Update the README, its five translations and `docs/logging.md`.

Non-goals:

- Marketplace applications of other vendors. Their secrets stay in the cloud.
- Paid, trial and subscription applications (`status` `P`, `T`, `D`, `S`).
- Proxy or fallback to the cloud OAuth server.
- Management of the catalog in the admin panel. The panel stays read-only.
- Changes to the Marketplace catalog download. The portal still gets the application package
  from the Marketplace servers.

## Capabilities

### New Capabilities

- `marketplace-catalog`: the CLI catalog of Marketplace applications that the server can serve,
  and the safe storage of their secrets.

### Modified Capabilities

- `application-registry`: add `application.install` and `application.uninstall` for catalog
  applications, the rejection of other installs, and many portals for one Marketplace `client_id`.
- `token-service`: the `status` field is `F` for Marketplace applications. Renewal verifies the
  secret from the catalog.

## Impact

- Code: `src/routes/rpc.ts`, `src/methods/applications.ts`, `src/methods/tokens.ts`,
  `src/tokens.ts`, `src/methods/events.ts`, `src/schema.ts`, `src/cli.ts`, the admin data views.
- Database: a new migration in `drizzle/` with a catalog table and a change to the uniqueness of
  `applications.client_id`.
- Protocol: two new RPC methods. The response shape of `application.install` comes from the portal
  code (`rest/lib/marketplace/application.php`), not from captured cloud traffic.
- Partner side: the backend of the application must renew tokens at `server_endpoint`, not at
  `oauth.bitrix.info`, for clients that use PocketAuth24.
- Docs: `README.md` and five translations, `docs/logging.md`, `docs/deployment.md`.

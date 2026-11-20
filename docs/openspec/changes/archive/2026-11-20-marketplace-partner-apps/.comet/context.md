# Comet Design Handoff

- Change: marketplace-partner-apps
- Phase: design
- Mode: compact
- Context hash: 05964156e16a2d7eb44cbbd8714b3539ecc439ff5866ab2f1c74398d8c8584de

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/marketplace-partner-apps/proposal.md

- Source: docs/openspec/changes/marketplace-partner-apps/proposal.md
- Lines: 1-62
- SHA256: 5ba02cf761f9e1cec03fdd792d9555d29630eb9e19cb370915a4298c5e0cf5c9

```md
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

```

## docs/openspec/changes/marketplace-partner-apps/design.md

- Source: docs/openspec/changes/marketplace-partner-apps/design.md
- Lines: 1-130
- SHA256: cbe125d487409e4e58944fb24f6c53a7962362b873ca4f93295ef0dbd17188f4

[TRUNCATED]

```md
## Context

PocketAuth24 serves only local applications. The `applications` table holds one row for each
local application, with a `client_id` that is unique in the whole database and the hash of its
own secret. Tokens (`token_pairs`) refer to an `applications` row.

A Marketplace application has one `client_id` and one `client_secret` for all portals. The
partner keeps the secret in its backend. The portal never gets the secret: the Marketplace install
stores `CLIENT_SECRET = ''` in `b_rest_app` (`rest/lib/marketplace/application.php`).

Facts from the portal code (`rest` module, on-premise source):

| Portal code | Server call | What the portal needs |
| --- | --- | --- |
| `Marketplace\Application::install` | `application.install` (`CLIENT_ID`, `VERSION`, optional `CHECK_HASH`, `INSTALL_HASH`) or `application.install.subscription` if `BY_SUBSCRIPTION` = `Y` | `result.client_id`, `result.version`, `result.status`, `result.scope` (list), `result.date_finish` only for `T` and `P` |
| `app.layout` `AuthTokenFiller` | `rest.authorize`; on `Application not installed` it calls `application.install` and tries again | `status` in the token answer; `CRestUtil::updateAppStatus` writes it to the application |
| `AppTable::uninstall` | `application.uninstall` for non-local applications only | any non-error answer |
| `AppTable::updateAppStatusInfo` | `application.list` | ignores an empty list |

The catalog download itself (`Marketplace\Client::getInstall`) goes to the Marketplace servers,
not to the OAuth server. This change does not touch it.

## Goals / Non-Goals

**Goals:**

- A partner serves its own Marketplace application on its clients' portals through its own
  PocketAuth24.
- Install, open, REST calls, events and renewal work as for a local application.
- Applications that are not in the catalog fail with a clear error.

**Non-Goals:**

- Applications of other vendors, paid, trial and subscription applications.
- Proxy to the cloud OAuth server.
- Catalog management in the admin panel.

## Decisions

### D1. A catalog table plus install rows in `applications`

Add a table `marketplace_apps` (`id`, `client_id` unique, `secret_hash`, `title`, `scope`,
`created_at`). A Marketplace install is a row in `applications` with `marketplace_app_id` set
(foreign key, `ON DELETE CASCADE`). A local application has `marketplace_app_id` = null.

- `applications.client_id` stays unique for local rows: a partial unique index
  `where marketplace_app_id is null`.
- An install row is unique per portal: a unique index on `(portal_id, client_id)`.
- For an install row, `secret_hash` is null. The secret comes from the catalog through the join.
  Thus, a secret rotation in the catalog applies to all installs at once.
- `title` and `scope` of an install row are copied from the catalog at each install. A token
  scope takes `applications.scope`, as now.

Why: tokens, events, `rest.check`, pruning and the admin views already work with `applications`
rows. One extra column keeps all these paths unchanged.

Alternatives:

- A separate `marketplace_installs` table with its own token relation. Rejected: each token path
  would need two branches.
- Copy the secret hash into each install row. Rejected: a rotation would need an update of all
  rows, and a missed row keeps an old secret valid.

### D2. Status from the row kind

`issuePair` and `rest.check` return `status` = `F` when `marketplace_app_id` is set, and `L`
when it is null. There is no status column. Paid statuses are a non-goal.

### D3. Install and uninstall are idempotent

- `application.install` upserts the install row on `(portal_id, client_id)` and keeps the row id.
  Thus, the existing tokens stay valid. `VERSION` is echoed as an integer, and the portal stores it.
- `application.uninstall` deletes the install row of the calling portal. Tokens go through the
  existing `ON DELETE CASCADE`. A missing row is not an error, because the portal calls uninstall
  also when the install never reached the server.
- `application.install.subscription` is always rejected (`reason`: `subscription_not_supported`).
- `application.update` and `application.delete` act only on rows where `marketplace_app_id` is null.

### D4. Renewal checks the catalog secret


```

Full source: docs/openspec/changes/marketplace-partner-apps/design.md

## docs/openspec/changes/marketplace-partner-apps/tasks.md

- Source: docs/openspec/changes/marketplace-partner-apps/tasks.md
- Lines: 1-39
- SHA256: 55e14c6553a2aa4ba603b0d3fee2e15c1b386a85673313222d873f5f1684b5cd

```md
## 1. Data model

- [ ] 1.1 Add `marketplace_apps` and `applications.marketplace_app_id` to `src/schema.ts`; make `applications.secret_hash` nullable; replace the global unique on `applications.client_id` with the partial unique index for local rows and the unique index on `(portal_id, client_id)`
- [ ] 1.2 Generate migration `drizzle/0004_marketplace_apps.sql` and check it on a database that already has local applications

## 2. Catalog CLI

- [ ] 2.1 Add `marketplace add` with hidden prompt and `--secret-stdin`, upsert by `client_id`
- [ ] 2.2 Add `marketplace list` (no secret, no hash) and `marketplace remove`
- [ ] 2.3 Tests: add, replace, list output without secrets, remove with cascade to installs and tokens

## 3. RPC methods

- [ ] 3.1 Implement `application.install`: catalog lookup, upsert of the install row, the result shape from the spec
- [ ] 3.2 Reject a `client_id` outside the catalog and `application.install.subscription` through `fail()` with the two reasons
- [ ] 3.3 Implement `application.uninstall` (idempotent, calling portal only)
- [ ] 3.4 Limit `application.update` and `application.delete` to local rows
- [ ] 3.5 Tests for each scenario in the `application-registry` delta spec, including the `request_failed` reasons

## 4. Tokens and events

- [ ] 4.1 Return `status` `F` for install rows and `L` for local rows in `rest.authorize`, `rest.check` and event auth
- [ ] 4.2 Check the catalog secret in `refresh` (D4)
- [ ] 4.3 Tests: authorize, check, renewal with the catalog secret, rotation, wrong secret, no cross-portal renewal, `ONAPPINSTALL` delivery for an install row

## 5. Admin panel

- [ ] 5.1 Make sure the applications view shows install rows and never shows a hash; add a test

## 6. Documentation

- [ ] 6.1 Add the two reasons to `docs/logging.md`
- [ ] 6.2 Add a partner section to `docs/deployment.md`: CLI commands, renewal at `server_endpoint`, effect of `marketplace remove`
- [ ] 6.3 Update the limits and features in `README.md` with Sepia, then the same change in the five translations

## 7. Verification

- [ ] 7.1 Run lint, type check and the full test suite
- [ ] 7.2 Install a real Marketplace application of the partner on a local test portal that uses PocketAuth24, or record in the verify report that this check was not possible

```

## docs/openspec/changes/marketplace-partner-apps/specs/application-registry/spec.md

- Source: docs/openspec/changes/marketplace-partner-apps/specs/application-registry/spec.md
- Lines: 1-71
- SHA256: 88ac8a76f237adf36d2bdbae34ce727aea6e96e15d4b69839b8a711961e2436e

```md
## ADDED Requirements

### Requirement: Install a Marketplace application
`application.install` SHALL accept `CLIENT_ID` and `VERSION`. If `CLIENT_ID` is in the catalog,
the server SHALL record the install for the calling portal and respond with
`{"result": {"client_id": "...", "version": <VERSION as integer>, "status": "F", "scope": [...]}}`,
where `scope` is the catalog scope as a list. The server SHALL ignore `CHECK_HASH` and
`INSTALL_HASH`. A repeated install on the same portal SHALL succeed and SHALL keep the existing
tokens. One Marketplace `client_id` SHALL be installable on many portals.

#### Scenario: Install from the Marketplace
- **WHEN** a portal calls `application.install` with `CLIENT_ID` `app.a1.1` from the catalog and `VERSION` 3
- **THEN** the server responds with `client_id` `app.a1.1`, `version` 3, `status` `F` and the catalog scope

#### Scenario: Repeated install
- **WHEN** a portal calls `application.install` for an application that it has already installed
- **THEN** the server responds with the same result and the existing tokens stay valid

### Requirement: Reject other Marketplace installs
If `CLIENT_ID` is not in the catalog, `application.install` SHALL respond with `error` =
`ERROR_OAUTH` and `error_description` = `Application is not in the PocketAuth24 catalog`.
`application.install.subscription` SHALL respond with `error` = `ERROR_OAUTH` and
`error_description` = `Subscription applications are not supported`. In both cases the server
SHALL change nothing, and the `request_failed` log line SHALL carry a `reason` for each cause.

#### Scenario: Application of another vendor
- **WHEN** a portal calls `application.install` with a `CLIENT_ID` that is not in the catalog
- **THEN** the server responds with the error above, records no install and logs `request_failed` with reason `client_id_not_in_catalog`

#### Scenario: Subscription install
- **WHEN** a portal calls `application.install.subscription`
- **THEN** the server responds with the error above and logs `request_failed` with reason `subscription_not_supported`

### Requirement: Uninstall a Marketplace application
`application.uninstall` SHALL accept `CLIENT_ID`, delete the install of the calling portal
together with all its tokens and respond with `{"result": true}`. If the calling portal has no
install of `CLIENT_ID`, the server SHALL respond with `{"result": true}` and change nothing. The
server SHALL NOT change installs of other portals or the catalog.

#### Scenario: Uninstall removes tokens
- **WHEN** a portal uninstalls `app.a1.1`
- **THEN** `rest.check` for its access tokens and `/oauth/token/` for its refresh tokens fail, and the install of `app.a1.1` on another portal still works

## MODIFIED Requirements

### Requirement: Update and delete local application
`application.update` SHALL change `TITLE`, `REDIRECT_URI` and `SCOPE` of the application
identified by `CLIENT_ID`. `application.delete` SHALL remove the application together
with all its tokens. Both SHALL respond with `{"result": true}` and SHALL only act on
local applications owned by the calling portal. Both SHALL NOT change a Marketplace install.

#### Scenario: Scope update applies to new tokens
- **WHEN** a portal updates an application's `SCOPE` and then calls `rest.authorize`
- **THEN** the new token carries the updated scope

#### Scenario: Delete removes tokens
- **WHEN** a portal deletes an application
- **THEN** `rest.check` for any of its access tokens and `/oauth/token/` for any of its refresh tokens fail

#### Scenario: Foreign application
- **WHEN** a portal calls `application.update` or `application.delete` with a `CLIENT_ID` it does not own, or with the `CLIENT_ID` of a Marketplace install
- **THEN** the server responds with an error and changes nothing

### Requirement: Application list
`application.list` SHALL respond with `{"result": []}`. The portal ignores an empty list
(`AppTable::updateAppStatusInfo`), so the status of a Marketplace install stays the status from
`application.install`.

#### Scenario: Status sync
- **WHEN** a portal calls `application.list`
- **THEN** the server responds with an empty result list

```

## docs/openspec/changes/marketplace-partner-apps/specs/marketplace-catalog/spec.md

- Source: docs/openspec/changes/marketplace-partner-apps/specs/marketplace-catalog/spec.md
- Lines: 1-37
- SHA256: 312bbead1cdf2ed741c7cac41603a450a0f306c08b3ebf72f7ba734395228eec

```md
## ADDED Requirements

### Requirement: Catalog of Marketplace applications
The server SHALL keep a catalog of Marketplace applications that it can serve. A catalog entry
SHALL hold the `client_id`, the hash of the `client_secret`, the title and the scope. One entry
SHALL apply to all portals that the server accepts.

#### Scenario: Entry serves all portals
- **WHEN** the catalog has an entry for `client_id` `app.a1.1`, and portals A and B install it
- **THEN** the server accepts both installs and keeps them apart

### Requirement: Manage the catalog through the CLI
The CLI SHALL add, list and remove catalog entries. The operator SHALL be the only person who
changes the catalog; the admin panel and the RPC methods SHALL NOT change it. The CLI SHALL read
the `client_secret` from a hidden prompt or from standard input, never from a command argument.
Adding an entry with a `client_id` that is already in the catalog SHALL replace its secret, title
and scope. The list SHALL show the `client_id`, the title and the scope, and SHALL NOT show the secret or its hash.

#### Scenario: Add an entry
- **WHEN** the operator adds `client_id` `app.a1.1` with a title, scope `crm,user` and a secret
- **THEN** the catalog contains the entry and stores only the hash of the secret

#### Scenario: Rotate the secret
- **WHEN** the operator adds `app.a1.1` again with a new secret
- **THEN** renewal with the old secret fails with `invalid_client` and renewal with the new secret succeeds

#### Scenario: Remove an entry
- **WHEN** the operator removes `app.a1.1`
- **THEN** the server deletes all installs of `app.a1.1` and all their tokens

### Requirement: Safe storage of catalog secrets
The server SHALL store a catalog `client_secret` only as a hash. Logs SHALL NOT contain the
secret.

#### Scenario: Database leak
- **WHEN** the catalog table is read directly
- **THEN** it contains no usable `client_secret`

```

## docs/openspec/changes/marketplace-partner-apps/specs/token-service/spec.md

- Source: docs/openspec/changes/marketplace-partner-apps/specs/token-service/spec.md
- Lines: 1-30
- SHA256: 804ab1a93c49b0f5f0fb83fc1ddc8da704a1a08e36479323de14720276b91887

```md
## MODIFIED Requirements

### Requirement: Token response format
Every successful `rest.authorize` token issue SHALL return these fields: `access_token`,
`refresh_token`, `expires` (Unix time), `expires_in` (seconds), `scope`
(comma-separated), `domain` (portal host), `server_endpoint` (`<server>/rest/`),
`client_endpoint` (`<portal>/rest/`), `member_id`, `status` (`L` for local
apps, `F` for Marketplace apps). `member_id` SHALL equal `md5` of the portal's current service `client_id`, the value
the portal computes in `OAuthService::getMemberId()`. The access token lifetime SHALL be
3600 seconds and the refresh token lifetime 180 days (6 months), as in the cloud. Renewal through `/oauth/token/` differs as specified below.

#### Scenario: Fields present
- **WHEN** a portal calls `rest.authorize`
- **THEN** the response contains every listed field with the portal's own host in `domain` and `client_endpoint`, and `member_id` equal to `md5` of the portal's service `client_id`

#### Scenario: Status of a Marketplace application
- **WHEN** a portal calls `rest.authorize` or `rest.check` for a Marketplace install
- **THEN** `status` is `F`, so the portal keeps the free status of the application

## ADDED Requirements

### Requirement: Renewal for Marketplace applications
`/oauth/token/` SHALL renew a refresh token of a Marketplace install when `client_id` is the
catalog `client_id` and `client_secret` matches the current catalog secret. All other renewal
rules SHALL be the same as for local applications. A refresh token of one portal SHALL NOT give
tokens for another portal.

#### Scenario: Partner backend renews a token
- **WHEN** the partner backend posts a valid refresh token of portal A with the catalog `client_id` and `client_secret`
- **THEN** the server returns a new pair for the same user and scope on portal A

```

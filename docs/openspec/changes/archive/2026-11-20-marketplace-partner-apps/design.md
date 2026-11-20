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

`refresh` in `src/tokens.ts` left-joins `marketplace_apps` and checks
`coalesce(marketplace_apps.secret_hash, applications.secret_hash)`. All other renewal checks
stay the same. The refresh token identifies the pair, and the pair identifies the portal, so one
catalog secret cannot give tokens for another portal.

### D5. CLI commands

Extend `src/cli.ts` (it now has `superuser set-password`):

- `marketplace add --client-id <id> --title <title> --scope <scope> [--secret-stdin]`: create or
  replace the entry. The secret comes from a hidden prompt or from the first line of standard
  input, as the superuser password does.
- `marketplace list`: `client_id`, title and scope. No secret and no hash.
- `marketplace remove --client-id <id>`: delete the entry. Installs and tokens go by cascade.

Each command exits with a non-zero code on bad input. The CLI writes nothing to the server log.

### D6. Errors and logs

Rejections go through `fail('ERROR_OAUTH', <description>, 400, <reason>)`. The `request_failed`
line from `logErrorResponse` carries the reason. No new log event is necessary. Add the reasons
`client_id_not_in_catalog` and `subscription_not_supported` to `docs/logging.md`.

## Risks / Trade-offs

- [The answer shape of `application.install` comes from the portal code, not from captured cloud
  traffic] → Test the install on a local test portal with a real Marketplace application of the
  partner before release. Record the result in the verify report.
- [The partner backend renews at `oauth.bitrix.info` by default] → Document that the backend must
  use `server_endpoint` from the token answer or from the event `auth` block.
- [Other vendors' applications on the same portal stop working] → Already in the README limits.
  Keep the text and add the partner case.
- [An operator removes a catalog entry by mistake] → The cascade deletes the installs and tokens.
  The admin re-adds the entry, and the portal installs the app again on the next open
  (`AuthTokenFiller` retry). Document this in the CLI help.
- [`CHECK_HASH` and `INSTALL_HASH` are ignored] → They protect paid and closed installs in the
  cloud. The catalog is the only access control here, and the operator controls it.

## Migration Plan

1. Migration `0004_marketplace_apps.sql`: create `marketplace_apps`, add
   `applications.marketplace_app_id`, make `applications.secret_hash` nullable, replace the unique
   constraint on `applications.client_id` with the two indexes from D1.
2. Existing rows are local rows (`marketplace_app_id` = null). No data change.
3. Rollback: drop the column and the table, and restore the unique constraint. This works only
   when no install rows exist, so remove the installs first (`marketplace remove`).

## Open Questions

- None that block the design. The live install test (first risk) is part of the verify phase.

# application-registry Specification

## Purpose
TBD - created by archiving change oauth-server-mvp. Update Purpose after archive.

## Requirements

### Requirement: Add local application
`application.add` SHALL accept `TITLE`, `REDIRECT_URI` and `SCOPE` and respond with
`{"result": {"client_id": "...", "client_secret": "...", "redirect_uri": "...", "scope": "..."}}`. The `client_id` SHALL use
the cloud local-app format `local.<14 hex>.<8 digits>`. The application SHALL belong to
the calling portal and SHALL be usable on it immediately: the portal never calls
`application.install` or `application.uninstall` for local apps (`AppTable::uninstall`
notifies the server only for non-local apps), and uninstalled local apps are blocked by
the portal itself.

#### Scenario: Portal creates a local app
- **WHEN** an authenticated portal calls `application.add` with a title, redirect URI and scope
- **THEN** the server stores the application and returns a new `client_id` in `local.*` format and a `client_secret`

#### Scenario: Local app is usable immediately
- **WHEN** `rest.authorize` is called for an application right after `application.add`
- **THEN** the server issues tokens

#### Scenario: Install URL of a local app still runs
- **WHEN** an administrator opens a newly added local app that has `URL_INSTALL` and is not yet marked installed on the portal (`b_rest_app.INSTALLED` = `N`)
- **THEN** `rest.authorize` succeeds, the portal opens `URL_INSTALL` with tokens, and after `BX24.installFinish` the portal marks the app installed without any further server call

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

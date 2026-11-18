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
applications owned by the calling portal.

#### Scenario: Scope update applies to new tokens
- **WHEN** a portal updates an application's `SCOPE` and then calls `rest.authorize`
- **THEN** the new token carries the updated scope

#### Scenario: Delete removes tokens
- **WHEN** a portal deletes an application
- **THEN** `rest.check` for any of its access tokens and `/oauth/token/` for any of its refresh tokens fail

#### Scenario: Foreign application
- **WHEN** a portal calls `application.update` or `application.delete` with a `CLIENT_ID` it does not own
- **THEN** the server responds with an error and changes nothing

### Requirement: Application list
`application.list` SHALL respond with `{"result": []}`, because marketplace applications
are not supported in a closed network.

#### Scenario: Status sync
- **WHEN** a portal calls `application.list`
- **THEN** the server responds with an empty result list


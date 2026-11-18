# portal-registration Specification

## Purpose
TBD - created by archiving change oauth-server-mvp. Update Purpose after archive.
## Requirements
### Requirement: Portal registration endpoint
The server SHALL expose `POST /oauth/register/` accepting the form fields sent by
`Bitrix\Rest\OAuthService::register()`: `redirect_uri` (portal base URL), `type`
(`B`), optional `member_id`, and optional licence fields (`BX_TYPE`, `BX_LICENCE`,
`BX_HASH`). On success it SHALL respond with JSON `{"client_id": "...",
"client_secret": "...", "host": "<portal host>"}` and persist the portal with its base URL and credentials.

#### Scenario: Allowed portal registers
- **WHEN** a portal whose `redirect_uri` host is in the configured allowlist posts to `/oauth/register/`
- **THEN** the server responds with a new `client_id` and `client_secret` and stores the portal

#### Scenario: Portal re-registers
- **WHEN** a portal with an already registered `redirect_uri` registers again
- **THEN** the server issues new service credentials for the same portal record, invalidates the previous credentials, and keeps the portal's applications and installations

### Requirement: Registration allowlist
The server SHALL accept registration only from portals whose `redirect_uri` host matches
the configured allowlist, because the portal cannot present any shared secret in this flow.
Licence fields, if present, SHALL be ignored in this stage.

#### Scenario: Unknown portal is rejected
- **WHEN** a portal whose host is not in the allowlist posts to `/oauth/register/`
- **THEN** the server responds with JSON containing `error` and `error_description` and stores nothing

### Requirement: Service call authentication
Every portal-facing `POST /rest/{method}` call SHALL be authenticated by the
`client_id` and `client_secret` form fields of a registered portal. The authenticated
portal SHALL scope every read and write of that call.

#### Scenario: Valid service credentials
- **WHEN** a portal calls `/rest/application.list` with its current `client_id` and `client_secret`
- **THEN** the server processes the call for that portal

#### Scenario: Invalid service credentials
- **WHEN** a call arrives with an unknown `client_id` or a wrong `client_secret`
- **THEN** the server responds with JSON `error` = `invalid_client` and performs no action

#### Scenario: Unknown method
- **WHEN** an authenticated portal calls a method the server does not implement
- **THEN** the server responds with JSON `error` = `ERROR_METHOD_NOT_FOUND`


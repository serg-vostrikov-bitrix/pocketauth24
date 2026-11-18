## Why

On-premise Bitrix24 portals delegate every OAuth operation (token issue, token check,
token renewal, local app registration, outgoing REST event delivery) to the cloud
servers `oauth.bitrix.info` / `oauth.bitrix24.tech`. In a closed network these hosts
are unreachable, so local applications written for the on-premise edition cannot get
or renew tokens and receive no events. The portal already lets an administrator point
it at another server (`rest` / `oauth_server` option), so a compatible standalone
server makes these applications work without patching the Bitrix24 core
(see `docs/research/2026-11-18-oauth-server-analysis.md`, decision 4.1).

This change delivers stage 1 (MVP): the minimum that lets local applications get,
use and renew tokens, and receive the install event, with no internet access.

## What Changes

- New standalone service `b24auth-server` with its own persistent storage of portals,
  applications and tokens.
- Portal-facing endpoint `POST /oauth/register/` that registers a portal and returns
  its service `client_id` / `client_secret`.
- Portal-facing RPC endpoint `POST /rest/{method}` authenticated by the portal's service
  credentials, implementing:
  - `application.add`, `application.update`, `application.delete` for local apps
    (the portal never calls install/uninstall on the server for local apps);
  - `application.list` returning an empty list (no marketplace in a closed network);
  - `rest.authorize`: issue an access/refresh token pair for an app and a portal user;
  - `rest.check`: validate an access token presented to the portal;
  - `rest.event.call`: basic event delivery, a single immediate POST to each handler
    with a freshly issued token, no persistent queue and no retries.
- App-facing endpoint `/oauth/token/` with `grant_type=refresh_token`
  (token auto-renewal), responding in the same format as the cloud server.
- Configuration, logging and a deployment unit suitable for a closed network.

Non-goals (later stages): `rest.code` and the `/oauth/authorize/` authorization-code
flow, `grant_type=authorization_code`, `/rest/app.info`, licence-signature
verification (`verification_needed`), persistent event queue with retries, admin UI,
migration of a portal already registered with the cloud, marketplace applications.

## Capabilities

### New Capabilities
- `portal-registration`: registering an on-premise portal with the server and
  authenticating its subsequent service calls.
- `application-registry`: lifecycle of local applications on a portal (add, update,
  delete, list).
- `token-service`: issuing, validating and renewing access/refresh tokens
  (`rest.authorize`, `rest.check`, `/oauth/token/` with `refresh_token`).
- `event-delivery`: accepting outgoing REST events from the portal and delivering them
  once to application handlers with a fresh token (`rest.event.call`).

### Modified Capabilities

None (no existing specs).

## Impact

- New code base in this repository: service, storage schema, tests, deployment files.
- New public HTTP API compatible with the subset of the Bitrix24 cloud OAuth protocol
  used by `Bitrix\Rest\OAuth\Client` (rest module 26.x).
- Portal side: no code changes; the administrator sets `rest` / `oauth_server` (or
  defines `BITRIX_OAUTH_URL`) and the portal re-registers on first use.
- Applications: must send token renewal to this server instead of
  `oauth.bitrix.info` (app configuration, or DNS override plus an internal-CA
  certificate; documented, not implemented here).
- Risk: exact cloud response formats are not in the box sources; they must be
  confirmed against real traffic before the API is frozen.

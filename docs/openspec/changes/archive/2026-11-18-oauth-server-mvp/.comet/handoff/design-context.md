# Comet Design Handoff

- Change: oauth-server-mvp
- Phase: design
- Mode: compact
- Context hash: 551fc88453d350cda3fe904651f576c14e2d1e99133e1903ba1ee21a776b3c51

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/oauth-server-mvp/proposal.md

- Source: docs/openspec/changes/oauth-server-mvp/proposal.md
- Lines: 1-66
- SHA256: 26872a0f1863ec4a897012fb00e133cc5d7880cf7f70260af853e0cb6a2ac52a

```md
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

```

## docs/openspec/changes/oauth-server-mvp/design.md

- Source: docs/openspec/changes/oauth-server-mvp/design.md
- Lines: 1-107
- SHA256: 343d2bbcfb6d963c03d1e8e54120246e5af9ac8cb07ecab84c53bcc073ee5e16

[TRUNCATED]

```md
## Context

The on-premise portal talks to its OAuth server only through
`Bitrix\Rest\OAuth\Client` (rest module 26.x): form-encoded `POST {server}/rest/{method}`
calls carrying the portal's service credentials, plus `POST {server}/oauth/register/`.
Applications talk to the server directly at `/oauth/token/`. The server address comes
from `BITRIX_OAUTH_URL` or the `rest` / `oauth_server` option. Full protocol map:
`docs/research/2026-11-18-oauth-server-analysis.md`.

Constraints: runs inside a customer's closed network with no internet; installed and
operated by the customer's administrators; must not require changes to the Bitrix24
core; one server may serve several portals.

## Goals / Non-Goals

**Goals:**
- Wire-compatible subset of the cloud protocol that lets a local app open in the portal,
  call portal REST, renew its token, and receive the install event.
- Simple deployment for closed networks: one service plus one database.
- Protocol layer isolated from storage so later stages (authorization code, app.info,
  persistent queue) add endpoints without reshaping the core.

**Non-Goals:**
- `rest.code`, `/oauth/authorize/`, `authorization_code` grant, `/rest/app.info`.
- Licence signature verification, marketplace applications, admin UI, migration from a
  cloud-registered portal, persistent event queue and retries.

## Decisions

### D1. Architecture: one HTTP service, three API surfaces

```
 portal (rest module)                         application
   │  POST /oauth/register/                      │  /oauth/token/ (refresh_token)
   │  POST /rest/{method} (service creds)        │
   ▼                                             ▼
 ┌───────────────────────────────────────────────────────┐
 │ HTTP layer: form/JSON parsing, cloud-format responses │
 ├───────────────┬───────────────┬───────────────────────┤
 │ portal auth   │ app registry  │ token service         │
 │               │               │ event dispatcher ─────┼──▶ POST app handler
 ├───────────────┴───────────────┴───────────────────────┤
 │ storage: portals, applications, installations, tokens │
 └───────────────────────────────────────────────────────┘
```

Alternative considered: separate token and event services. Rejected for the MVP: more
moving parts to deploy in a closed network for no gain at expected volumes.

### D2. Opaque random tokens stored as hashes
Access and refresh tokens are random strings (≥ 32 bytes, URL-safe), stored as SHA-256
hashes with their metadata (portal, application, user, scope, parameters, expiry). Alternative: signed JWT. Rejected: the portal already calls
`rest.check` and caches the result for an hour, so self-contained tokens add no value and
make revocation on uninstall harder.

### D3. Reusable refresh tokens
Each refresh issues a new pair; the old refresh token stays valid until its own expiry.
This follows observed cloud behaviour (contrary to the public docs) and is confirmed by
the traffic capture. Alternative: single-use rotation. Rejected for compatibility: apps
that race two workers or lose the new refresh token would lose access for good.

### D4. Portal admission by allowlist
`/oauth/register/` carries no secret the server could check (licence hash is out of
scope), so registration is limited to configured portal hosts. Service calls are then
authenticated by the issued `client_id` / `client_secret` (secret stored hashed).

### D5. Event delivery in-process, best effort
`rest.event.call` responds immediately and starts each delivery in-process with a
per-request timeout and a cap on deliveries in flight. No persistence; overflow and
failures are logged. Stage 3 replaces the worker with a persistent queue behind the same interface.

### D6. Cloud-compatible response shapes
Portal RPC responses use `{"result": ...}` or `{"error", "error_description"}`;
`/oauth/token/` returns the token object at top level. Field names and error codes follow
what the rest module reads (see specs). Before freezing, the shapes are compared with
captured traffic from a test portal against the cloud server.

### D7. Stack
Node.js + TypeScript (Fastify, Drizzle, Vitest) with PostgreSQL, chosen in the design
phase; see the Design Doc. NTC policy defaults new projects to .NET, so a CTO exception

```

Full source: docs/openspec/changes/oauth-server-mvp/design.md

## docs/openspec/changes/oauth-server-mvp/tasks.md

- Source: docs/openspec/changes/oauth-server-mvp/tasks.md
- Lines: 1-40
- SHA256: 4f029f5fcc82d03e1a6578e53d2486c4b9de7c8b80c3c9a63c9bde654c0ddb7f

```md
## 1. Protocol capture and project setup

- [ ] 1.1 Capture real request/response pairs from a test on-premise portal against the cloud server with `mitmdump` in reverse mode (HAR export) for `/oauth/register/`, `rest.authorize`, `rest.check`, `application.add`, `rest.event.call`, `/oauth/token/` and an event POST to a handler; refresh twice with the same refresh token to confirm reuse behaviour; store sanitized fixtures in the repo
- [ ] 1.2 Create the Node.js + TypeScript Fastify service skeleton (CTO exception recorded): config loading (base URL, portal allowlist, DB connection, event timeout and in-flight cap), structured logging, health endpoint
- [ ] 1.3 Add container image and docker-compose for offline deployment with the database
- [ ] 1.4 Set up test runner and CI checks

## 2. Storage

- [ ] 2.1 Define schema and migrations for portals, applications and token pairs (hashed values, metadata, expiry); every query filters by the calling portal

## 3. Portal registration and authentication

- [ ] 3.1 Implement `POST /oauth/register/` with allowlist check, new and repeated registration
- [ ] 3.2 Implement service-credential authentication for `POST /rest/{method}`, method dispatch with `invalid_client` and `ERROR_METHOD_NOT_FOUND` errors, and `result` / `error` response helpers

## 4. Application registry

- [ ] 4.1 Implement `application.add` with `local.*` client_id format
- [ ] 4.2 Implement `application.update` and `application.delete` with ownership check; delete cascades tokens
- [ ] 4.3 Implement `application.list` returning an empty list

## 5. Token service

- [ ] 5.1 Implement secure token generation, hashing and the token response builder (including `member_id`)
- [ ] 5.2 Implement `rest.authorize` with scope intersection and stored `PARAMS`
- [ ] 5.3 Implement `rest.check` with `invalid_token` / `expired_token` errors
- [ ] 5.4 Implement `/oauth/token/` (GET and POST) for `refresh_token` with reusable refresh tokens and `invalid_grant` / `invalid_client` / `unsupported_grant_type` errors

## 6. Event delivery

- [ ] 6.1 Implement `rest.event.call` intake and fire-and-forget delivery with timeout and in-flight cap
- [ ] 6.2 Implement the handler POST with the `auth` block rules (`sendAuth`, `sendRefreshToken`, no-user events)
- [ ] 6.3 Log delivery failures without retries

## 7. Verification and documentation

- [ ] 7.1 Contract tests comparing responses with the captured fixtures from 1.1
- [ ] 7.2 End-to-end check on the test portal with no internet: local app with UI runs its `URL_INSTALL` page with tokens, finishes installation via `BX24.installFinish`, then opens and calls REST; server-side local app receives `ONAPPINSTALL` with tokens; both renew tokens via `/oauth/token/`
- [ ] 7.3 Write the deployment guide: server setup, portal `oauth_server` switch and re-registration, re-creating local apps, app renewal URL (config change or DNS plus internal-CA certificate), rollback

```

## docs/openspec/changes/oauth-server-mvp/specs/application-registry/spec.md

- Source: docs/openspec/changes/oauth-server-mvp/specs/application-registry/spec.md
- Lines: 1-48
- SHA256: 66f39ee8f56256894bcbea2650cae2bcfd973cb442f93cf4f46b7119102c7038

```md
## ADDED Requirements

### Requirement: Add local application
`application.add` SHALL accept `TITLE`, `REDIRECT_URI` and `SCOPE` and respond with
`{"result": {"client_id": "...", "client_secret": "..."}}`. The `client_id` SHALL use
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

```

## docs/openspec/changes/oauth-server-mvp/specs/event-delivery/spec.md

- Source: docs/openspec/changes/oauth-server-mvp/specs/event-delivery/spec.md
- Lines: 1-40
- SHA256: 419ff1d49cec58598c11ff11595401dd001b817039f58be356cd5c84c9fec5df

```md
## ADDED Requirements

### Requirement: Accept events from the portal
`rest.event.call` SHALL accept `QUERY`, a list of items in the `Bitrix\Rest\Sqs::queryItem`
format (`client_id`, `auth`, `query.QUERY_URL`, `query.QUERY_DATA`, `additional`), and
respond with `{"result": true}` without waiting for handler delivery to finish.

#### Scenario: Portal hands over events
- **WHEN** a portal calls `rest.event.call` with two items
- **THEN** the server responds with `result` true and schedules both deliveries

### Requirement: Deliver once with a fresh token
For each item the server SHALL send one HTTP POST (form-encoded) to `query.QUERY_URL`
with fields `event`, `event_handler_id`, `data`, `ts` taken from `QUERY_DATA`, and an
`auth` block. When `client_id` is set, `auth.LOCAL_USER` is greater than 0 and
`additional.sendAuth` is true, the `auth` block SHALL contain a newly issued token
response plus `application_token`; `refresh_token` SHALL be included only when
`additional.sendRefreshToken` is true. Otherwise `auth` SHALL contain only `domain`,
`member_id` and `application_token`.

#### Scenario: Install event reaches a server-side app
- **WHEN** a portal sends an `ONAPPINSTALL` item with `sendAuth` and `sendRefreshToken` true for user 1
- **THEN** the app handler receives a POST whose `auth` contains `access_token`, `refresh_token`, `domain`, `member_id` and `application_token`

#### Scenario: Event without user auth
- **WHEN** an item has no `client_id` or `LOCAL_USER` is 0
- **THEN** the handler receives `auth` with only `domain`, `member_id` and `application_token`

### Requirement: No retries in this stage
A failed delivery (connection error, timeout, non-2xx status) SHALL be logged with the
portal, client_id, event name and handler URL, and SHALL NOT be retried. Pending
deliveries SHALL NOT survive a server restart.

#### Scenario: Handler is down
- **WHEN** the handler URL refuses the connection
- **THEN** the server logs the failure once and does not send the event again

#### Scenario: Overload
- **WHEN** an item arrives while the number of deliveries in flight is at the configured limit
- **THEN** the server logs the item as dropped and does not deliver it

```

## docs/openspec/changes/oauth-server-mvp/specs/portal-registration/spec.md

- Source: docs/openspec/changes/oauth-server-mvp/specs/portal-registration/spec.md
- Lines: 1-42
- SHA256: 77480bf5ef0dc0aa4f4b3008588f81fbe1bf174916fbd9038361b88c77ef06ab

```md
## ADDED Requirements

### Requirement: Portal registration endpoint
The server SHALL expose `POST /oauth/register/` accepting the form fields sent by
`Bitrix\Rest\OAuthService::register()`: `redirect_uri` (portal base URL), `type`
(`B`), optional `member_id`, and optional licence fields (`BX_TYPE`, `BX_LICENCE`,
`BX_HASH`). On success it SHALL respond with JSON `{"client_id": "...",
"client_secret": "..."}` and persist the portal with its base URL and credentials.

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

```

## docs/openspec/changes/oauth-server-mvp/specs/token-service/spec.md

- Source: docs/openspec/changes/oauth-server-mvp/specs/token-service/spec.md
- Lines: 1-83
- SHA256: d2e6a6808102815636527e5c6572e0ebde21a1e4fdc4f18b28a3353a83a14ac5

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: Token response format
Every successful token issue SHALL return these fields: `access_token`,
`refresh_token`, `expires` (Unix time), `expires_in` (seconds), `scope`
(comma-separated), `domain` (portal host), `server_endpoint` (`<server>/rest/`),
`client_endpoint` (`<portal>/rest/`), `member_id`, `user_id`, `status` (`L` for local
apps). `member_id` SHALL equal `md5` of the portal's current service `client_id`, the value
the portal computes in `OAuthService::getMemberId()`. The access token lifetime SHALL be
3600 seconds and the refresh token lifetime 180 days (6 months), as in the cloud.

#### Scenario: Fields present
- **WHEN** any token is issued
- **THEN** the response contains every listed field with the portal's own host in `domain` and `client_endpoint`, and `member_id` equal to `md5` of the portal's service `client_id`

### Requirement: Issue tokens for the portal
`rest.authorize` SHALL accept `CLIENT_ID`, `SCOPE` and `PARAMS` (containing
`LOCAL_USER`, `TZ_OFFSET` and the event session) and respond with
`{"result": <token response>}`. The token scope SHALL be the intersection of the
requested `SCOPE` and the application scope. `PARAMS` SHALL be stored with the token,
and `user_id` SHALL equal `PARAMS.LOCAL_USER`.

#### Scenario: App page opens
- **WHEN** a portal calls `rest.authorize` for an installed application and user 5
- **THEN** the server returns a new token pair with `user_id` 5 and stores `PARAMS` with it

#### Scenario: Unknown application
- **WHEN** `rest.authorize` is called with a `CLIENT_ID` not owned by the portal
- **THEN** the server responds with `error` = `ERROR_OAUTH` and `error_description` = `Application not installed`

### Requirement: Validate tokens for the portal
`rest.check` SHALL accept `TOKEN` and, for a valid access token issued on the calling
portal, respond with `{"result": {...}}` containing `client_id`, `expires`, `scope`,
`member_id`, `user_id` and `parameters` (the stored `PARAMS`, including `LOCAL_USER`).

#### Scenario: Valid token
- **WHEN** a portal checks an access token the server issued for it
- **THEN** the result contains the token's `client_id`, `expires`, `scope` and `parameters.LOCAL_USER`

#### Scenario: Unknown or foreign token
- **WHEN** a portal checks a token that does not exist (including tokens of a deleted application) or belongs to another portal
- **THEN** the server responds with `error` = `invalid_token` and no `result`

#### Scenario: Expired token
- **WHEN** a portal checks an access token whose `expires` is in the past
- **THEN** the server responds with `error` = `expired_token`

### Requirement: Token renewal for applications
`/oauth/token/` SHALL accept GET and POST with `grant_type=refresh_token`,
`client_id`, `client_secret` and `refresh_token`, and respond with the token response
as top-level JSON (not wrapped in `result`). The new pair SHALL keep the user, scope
and stored parameters of the old one. A refresh token SHALL stay valid until its own
expiry and MAY be presented again, matching observed cloud behaviour (confirmed against
captured traffic before release). An expired or unknown refresh token SHALL be rejected
with `invalid_grant`.

#### Scenario: Successful renewal
- **WHEN** an application posts a valid unused refresh token with its own `client_id` and `client_secret`
- **THEN** the server returns a new access token and a new refresh token for the same user and scope

#### Scenario: Refresh token reused
- **WHEN** an application presents a refresh token that was already used and has not expired
- **THEN** the server returns another new token pair for the same user and scope

#### Scenario: Refresh token expired or unknown
- **WHEN** an application presents a refresh token past its expiry or one that does not exist (including tokens of a deleted application)
- **THEN** the server responds with `error` = `invalid_grant`

#### Scenario: Wrong application secret
- **WHEN** the `client_secret` does not match the application of the refresh token
- **THEN** the server responds with `error` = `invalid_client`

#### Scenario: Unsupported grant type
- **WHEN** `grant_type` is anything other than `refresh_token`
- **THEN** the server responds with `error` = `unsupported_grant_type`

### Requirement: Token storage safety
The server SHALL store only hashes of access and refresh tokens and SHALL generate
tokens with a cryptographically secure random source.


```

Full source: docs/openspec/changes/oauth-server-mvp/specs/token-service/spec.md

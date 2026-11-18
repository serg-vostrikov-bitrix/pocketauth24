## ADDED Requirements

### Requirement: Token response format
Every successful `rest.authorize` token issue SHALL return these fields: `access_token`,
`refresh_token`, `expires` (Unix time), `expires_in` (seconds), `scope`
(comma-separated), `domain` (portal host), `server_endpoint` (`<server>/rest/`),
`client_endpoint` (`<portal>/rest/`), `member_id`, `status` (`L` for local
apps). `member_id` SHALL equal `md5` of the portal's current service `client_id`, the value
the portal computes in `OAuthService::getMemberId()`. The access token lifetime SHALL be
3600 seconds and the refresh token lifetime 180 days (6 months), as in the cloud. Renewal through `/oauth/token/` differs as specified below.

#### Scenario: Fields present
- **WHEN** a portal calls `rest.authorize`
- **THEN** the response contains every listed field with the portal's own host in `domain` and `client_endpoint`, and `member_id` equal to `md5` of the portal's service `client_id`

### Requirement: Issue tokens for the portal
`rest.authorize` SHALL accept `CLIENT_ID`, `SCOPE` and `PARAMS` (containing
`LOCAL_USER`, `TZ_OFFSET` and the event session) and respond with
`{"result": <token response>}`. The token scope SHALL be the intersection of the
requested `SCOPE` and the application scope. `PARAMS` SHALL be stored with the token;
the stored user SHALL equal `PARAMS.LOCAL_USER`.

#### Scenario: App page opens
- **WHEN** a portal calls `rest.authorize` for an installed application and user 5
- **THEN** the server returns a new token pair for user 5 and stores `PARAMS` with it

#### Scenario: Unknown application
- **WHEN** `rest.authorize` is called with a `CLIENT_ID` not owned by the portal
- **THEN** the server responds with `error` = `ERROR_OAUTH` and `error_description` = `Application not installed`

### Requirement: Validate tokens for the portal
`rest.check` SHALL accept `TOKEN` and, for a valid access token issued on the calling
portal, respond with `{"result": {...}}` containing `access_token`, `expires_in`, `expires`, `scope`,
`client_id`, `parameters` (the stored `PARAMS`, including `LOCAL_USER`) and `status`. An
unknown token is answered with HTTP 400.

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
as top-level JSON (not wrapped in `result`) with `user_id` added, `scope` set to the
literal `app` and `domain` set to the OAuth server host, as the cloud does. The new pair SHALL keep the user, scope
and stored parameters of the old one. A refresh token SHALL stay valid until its own
expiry and MAY be presented again, matching observed cloud behaviour (confirmed against
captured traffic before release). An expired or unknown refresh token SHALL be rejected
with `invalid_grant`. `/oauth/token/` errors are HTTP 400; `invalid_grant` and `invalid_client` carry no
`error_description`.

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
- **THEN** the server responds with `error` = `invalid_request` (`invalid_grant` for `authorization_code`)

### Requirement: Token storage safety
The server SHALL store only hashes of access and refresh tokens and SHALL generate
tokens with a cryptographically secure random source.

#### Scenario: Database leak
- **WHEN** the token table is read directly
- **THEN** it contains no usable access or refresh token values

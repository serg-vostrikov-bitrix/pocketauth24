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

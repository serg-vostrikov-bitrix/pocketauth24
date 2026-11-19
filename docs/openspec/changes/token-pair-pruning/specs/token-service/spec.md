## MODIFIED Requirements

### Requirement: Token renewal for applications
`/oauth/token/` SHALL accept GET and POST with `grant_type=refresh_token`,
`client_id`, `client_secret` and `refresh_token`, and respond with the token response
as top-level JSON (not wrapped in `result`) with `user_id` added, `scope` set to the
literal `app` and `domain` set to the OAuth server host, as the cloud does. The new pair SHALL keep the user, scope
and stored parameters of the old one. A refresh token SHALL stay valid until its own
expiry or until the server prunes its pair (see "Pruning of old token pairs"), and MAY be
presented again, matching observed cloud behaviour (confirmed against captured traffic before
release). An expired, unknown or pruned refresh token SHALL be rejected with `invalid_grant`.
`/oauth/token/` errors are HTTP 400; `invalid_grant` and `invalid_client` carry no
`error_description`.

#### Scenario: Successful renewal
- **WHEN** an application posts a valid unused refresh token with its own `client_id` and `client_secret`
- **THEN** the server returns a new access token and a new refresh token for the same user and scope

#### Scenario: Refresh token reused
- **WHEN** an application presents a refresh token that was already used, has not expired and was not pruned
- **THEN** the server returns another new token pair for the same user and scope

#### Scenario: Refresh token expired, unknown or pruned
- **WHEN** an application presents a refresh token past its expiry, one that does not exist (including tokens of a deleted application), or one whose pair was pruned
- **THEN** the server responds with `error` = `invalid_grant`

#### Scenario: Wrong application secret
- **WHEN** the `client_secret` does not match the application of the refresh token
- **THEN** the server responds with `error` = `invalid_client`

#### Scenario: Unsupported grant type
- **WHEN** `grant_type` is anything other than `refresh_token`
- **THEN** the server responds with `error` = `invalid_request` (`invalid_grant` for `authorization_code`)

## ADDED Requirements

### Requirement: Pruning of old token pairs
A pair is "used" when the server has accepted its refresh token in a successful renewal at
least once. The server SHALL record the time of the first such renewal on the pair, in the same
transaction that issues the new pair. When `TOKEN_PRUNING` is `true` (the default), each time
the server issues a token pair it SHALL delete the used pairs of the same application and user
that are older than the newest `TOKEN_PRUNING_KEEP` used pairs (default 5) and whose access token
has expired. The server SHALL NOT delete a pair that is not used, or a pair whose access token
has not expired. When `TOKEN_PRUNING` is `false`, the server SHALL keep each pair until its
refresh token expires. The server SHALL stop at start if `TOKEN_PRUNING` is not `true` or
`false`, or if `TOKEN_PRUNING_KEEP` is not a positive integer.

#### Scenario: Old used pairs are deleted
- **WHEN** pruning is on with keep 5, and after an issue a user of an application has 6 used pairs whose access token has expired
- **THEN** the oldest used pair is deleted and its refresh token gets `invalid_grant`

#### Scenario: Unused pairs are kept
- **WHEN** pruning is on with keep 5, a backend keeps the refresh token of an unused pair whose access token has expired, and the server issues 10 newer pairs for the same user of the application
- **THEN** the unused pair stays and its refresh token gets a new pair

#### Scenario: Live access tokens are kept
- **WHEN** pruning is on with keep 5, a user of an application has 7 used pairs with a live access token, and the server issues a new pair for them
- **THEN** all 8 pairs stay

#### Scenario: Other users and applications are not touched
- **WHEN** the server issues a pair for one user of one application
- **THEN** pairs of other users and other applications stay

#### Scenario: Pruning is off
- **WHEN** `TOKEN_PRUNING` is `false` and the server issues a new pair
- **THEN** no pair is deleted

#### Scenario: Invalid setting
- **WHEN** `TOKEN_PRUNING` is `yes`, or `TOKEN_PRUNING_KEEP` is `0` or `abc`
- **THEN** the server stops at start with an error that names the variable

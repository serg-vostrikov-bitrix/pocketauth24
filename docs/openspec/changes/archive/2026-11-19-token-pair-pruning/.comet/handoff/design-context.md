# Comet Design Handoff

- Change: token-pair-pruning
- Phase: design
- Mode: compact
- Context hash: 16a6ef0c1a1c6691b6b09256219fcfc3ff19f3526db21cae37ad6377b7e6ce8c

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/token-pair-pruning/proposal.md

- Source: docs/openspec/changes/token-pair-pruning/proposal.md
- Lines: 1-43
- SHA256: cbaef73f8583e82ae9176fe99410b49a73dcaa5172307379e9ad47c22fdf67bf

```md
## Why

Each refresh and each `rest.authorize` call adds a new row to `token_pairs`. The old row stays
until its refresh token expires, after 180 days. An application that refreshes every hour leaves
about 4,320 rows per user. With 1,000 users and 10 applications the table holds about 43 million
rows. The table also has no index on `application_id` or `created_at`, so the cascade delete of an
application and the admin token list scan the full table.

Backlog issue: https://github.com/serg-vostrikov-bitrix/pocketauth24/issues/28

## What Changes

- When the server issues a new token pair, it deletes old pairs of the same application and user.
  It keeps the last X pairs. It deletes a pair only if its access token has expired.
  A live access token is never deleted.
- New environment variable `TOKEN_PRUNING` (`true` or `false`, default `true`) turns this pruning
  on or off. With `false`, the server keeps every pair until its refresh token expires, as the
  Bitrix24 cloud does.
- New environment variable `TOKEN_PRUNING_KEEP` (positive integer, default `5`) sets X.
- The server stops at start if either variable has an invalid value.
- New indexes: `token_pairs (application_id, user_id, created_at)`, `token_pairs (created_at)`,
  `applications (portal_id)`. A new Drizzle migration adds them.
- **BREAKING** (only with pruning on, the default): an old refresh token that is not in the last X
  pairs and whose access token has expired stops working. The application gets `invalid_grant`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `token-service`: the requirement on token renewal changes. A refresh token stays valid until its
  own expiry only while its pair is not pruned. A new requirement describes the pruning and its
  two settings.

## Impact

- Code: `src/tokens.ts` (`issuePair`), `src/config.ts` (`Config`, `loadConfig`), `src/schema.ts`.
- Database: new migration in `drizzle/` with three indexes. No column changes.
- Docs: `README.md` and its five translations, `docs/deployment.md` (environment variables).
- Out of scope: OFFSET pagination and `count(*)` in the admin lists.

```

## docs/openspec/changes/token-pair-pruning/design.md

- Source: docs/openspec/changes/token-pair-pruning/design.md
- Lines: 1-105
- SHA256: c6e2feff8824f573e14dc12719f0578ab6e608186004e397d36e1b5f642bc8cc

[TRUNCATED]

```md
## Context

All token pairs come from `issuePair` in `src/tokens.ts`. Three callers use it: `rest.authorize`
(`src/methods/tokens.ts`), event auth (`src/methods/events.ts`) and `/oauth/token/` refresh
(`refresh` in `src/tokens.ts`). A refresh does not delete the old pair, by design (spec D3 of
`oauth-server-mvp`): the cloud also accepts a used refresh token again. The hourly cleanup
(`deleteExpiredPairs`) deletes only pairs with an expired refresh token, so rows live for 180 days.

`token_pairs` has unique indexes on `access_hash` and `refresh_hash` and one index on
`refresh_expires_at`. The foreign key `application_id` and the admin sort column `created_at`
have no index. `applications.portal_id` has no index either.

## Goals / Non-Goals

**Goals:**

- Keep the number of rows per application and user small and bounded in normal use.
- Never break an access token that is still live.
- Let an operator turn pruning off to get the exact cloud behaviour.
- Add the missing indexes.

**Non-Goals:**

- Admin list pagination (OFFSET) and `count(*)` optimization.
- A hard upper bound on rows. Pairs with a live access token are never deleted, so a burst of
  issues inside one hour can leave more than X rows for that hour.
- Changes to the hourly cleanup.

## Decisions

### D1. Prune inside `issuePair`, after the insert

One `DELETE` runs after the `INSERT`, for the same `application_id` and `user_id`:

```sql
delete from token_pairs
where application_id = $app and user_id = $user
  and access_expires_at <= $now
  and id not in (
    select id from token_pairs
    where application_id = $app and user_id = $user
    order by created_at desc, id desc
    limit $keep)
```

`$now` comes from app code (`Date.now()`), as the expiry does, so fake timers work in tests.

Alternatives:

- Prune in the hourly cleanup job. Rejected: a global sweep over all users needs a window
  function over the whole table, and rows still grow between runs.
- Delete the presented pair on refresh (single-use refresh tokens). Rejected: it breaks the
  reuse that the cloud allows and that SDKs can depend on after a lost response.

### D2. Only pairs with an expired access token are deleted

`rest.authorize` and event auth issue pairs often: each app page open, placement or business
process action. A strict "last X" rule would delete a pair that another tab or process still
uses. With the extra condition, a deleted pair has a dead access token. Only its refresh token
stops working, and a client keeps the newest refresh token after each refresh.

### D3. Two environment variables

- `TOKEN_PRUNING`: `true` or `false`, default `true`. Parsed like `TRUST_PROXY`: any other
  value stops the server at start.
- `TOKEN_PRUNING_KEEP`: positive integer, default `5`. Other values stop the server.

`Config` gets one field `tokenPruningKeep: number | null`. `null` means pruning is off. This
keeps one value for `issuePair` to check. The server reads `TOKEN_PRUNING_KEEP` also when
pruning is off, so a bad value fails at start in both cases.

Alternative: one variable where `0` means off. Rejected: the user asked for a separate switch,
and an explicit `false` is easier to read in `.env`.

### D4. Indexes in one migration

- `token_pairs_app_user_created_idx` on `(application_id, user_id, created_at)`: serves the
  prune query and the `ON DELETE CASCADE` from `applications` (prefix `application_id`).
- `token_pairs_created_at_idx` on `(created_at)`: the admin token list sorts by it.
- `applications_portal_id_idx` on `(portal_id)`: cascade from `portals`, the admin join and the

```

Full source: docs/openspec/changes/token-pair-pruning/design.md

## docs/openspec/changes/token-pair-pruning/tasks.md

- Source: docs/openspec/changes/token-pair-pruning/tasks.md
- Lines: 1-18
- SHA256: e99c564f267660db414c5d30de1d0382c72198d112f29e8e878c929f76e307b3

```md
## 1. Configuration

- [ ] 1.1 Add `TOKEN_PRUNING` and `TOKEN_PRUNING_KEEP` parsing to `loadConfig` (`Config.tokenPruningKeep: number | null`), with unit tests for defaults, `false`, and invalid values

## 2. Pruning

- [ ] 2.1 Delete old pairs with an expired access token in `issuePair` after the insert, when `tokenPruningKeep` is not `null`
- [ ] 2.2 Add integration tests: old expired pairs deleted and their refresh token gets `invalid_grant`; live pairs kept; other users and applications untouched; pruning off deletes nothing

## 3. Indexes

- [ ] 3.1 Declare the three indexes in `src/schema.ts` and generate the Drizzle migration `drizzle/0003_*.sql`
- [ ] 3.2 Check that migrations apply on a clean database and on the current schema

## 4. Documentation

- [ ] 4.1 Add both variables to `docs/deployment.md`
- [ ] 4.2 Add both variables to `README.md` with the note on cloud behaviour, and the same change to the five translations

```

## docs/openspec/changes/token-pair-pruning/specs/token-service/spec.md

- Source: docs/openspec/changes/token-pair-pruning/specs/token-service/spec.md
- Lines: 1-64
- SHA256: 17372983edf9ee5456f28380cd5ff3d93bbf8fbdb9bbb0d1bba2910f3b840652

```md
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
When `TOKEN_PRUNING` is `true` (the default), each time the server issues a token pair it SHALL
delete the pairs of the same application and user that are older than the newest
`TOKEN_PRUNING_KEEP` pairs (default 5) and whose access token has expired. The server SHALL NOT
delete a pair whose access token has not expired. When `TOKEN_PRUNING` is `false`, the server
SHALL keep each pair until its refresh token expires. The server SHALL stop at start if
`TOKEN_PRUNING` is not `true` or `false`, or if `TOKEN_PRUNING_KEEP` is not a positive
integer.

#### Scenario: Old expired pairs are deleted
- **WHEN** pruning is on with keep 5, a user of an application has 5 pairs with an expired access token, and the server issues a new pair for them
- **THEN** the oldest pair is deleted and its refresh token gets `invalid_grant`

#### Scenario: Live access tokens are kept
- **WHEN** pruning is on with keep 5, a user of an application has 7 pairs with a live access token, and the server issues a new pair for them
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

```

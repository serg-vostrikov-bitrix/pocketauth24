## Why

Each refresh and each `rest.authorize` call adds a new row to `token_pairs`. The old row stays
until its refresh token expires, after 180 days. An application that refreshes every hour leaves
about 4,320 rows per user. With 1,000 users and 10 applications the table holds about 43 million
rows. The table also has no index on `application_id` or `created_at`, so the cascade delete of an
application and the admin token list scan the full table.

Backlog issue: https://github.com/serg-vostrikov-bitrix/pocketauth24/issues/28

## What Changes

- A refresh marks the old pair as "used" (new nullable column `token_pairs.refreshed_at`).
- When the server issues a new token pair, it deletes old used pairs of the same application and
  user. It keeps the last X used pairs. It deletes a pair only if its access token has expired.
  An unused pair and a live access token are never deleted. A backend that keeps the refresh
  token from an app install or page open therefore never loses it.
- New environment variable `TOKEN_PRUNING` (`true` or `false`, default `true`) turns this pruning
  on or off. With `false`, the server keeps every pair until its refresh token expires, as the
  Bitrix24 cloud does.
- New environment variable `TOKEN_PRUNING_KEEP` (positive integer, default `5`) sets X.
- The server stops at start if either variable has an invalid value.
- New indexes: `token_pairs (application_id, user_id, created_at)`, `token_pairs (created_at)`,
  `applications (portal_id)`. A new Drizzle migration adds them and the column.
- **BREAKING** (only with pruning on, the default): a refresh token that was already exchanged,
  is not in the last X used pairs, and whose access token has expired stops working. The application gets `invalid_grant`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `token-service`: the requirement on token renewal changes. A refresh token stays valid until its
  own expiry only while its pair is not pruned. A new requirement describes the pruning and its
  two settings.

## Impact

- Code: `src/tokens.ts` (`issuePair`), `src/config.ts` (`Config`, `loadConfig`), `src/schema.ts`.
- Database: new migration in `drizzle/` with three indexes. One new nullable column `token_pairs.refreshed_at`.
- Docs: `README.md` and its five translations, `docs/deployment.md` (environment variables).
- Out of scope: OFFSET pagination and `count(*)` in the admin lists.

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
  per-portal application count.

Declared in `src/schema.ts`; `drizzle-kit generate` writes `drizzle/0003_*.sql`. Migrations run
at start (existing behaviour). Plain `CREATE INDEX` locks writes to the table while it runs.

## Risks / Trade-offs

- [An SDK keeps an old refresh token and uses it after more than X newer pairs exist] →
  `invalid_grant`; the user must open the app again. CRest and the official SDKs store the newest
  refresh token after each refresh. Operators who need full cloud behaviour set
  `TOKEN_PRUNING=false`. The README says this.
- [Index creation on a large existing table blocks writes at start] → the table on current
  installations is small (product is new). Not mitigated further.
- [One extra `DELETE` per issue] → it uses the new composite index and touches few rows.
- [Existing installations have many old rows] → pruning cleans a user's rows at their next issue.
  The rest go with the hourly cleanup after 180 days. No one-time backfill.

## Migration Plan

Deploy the new image. The migration adds the indexes at start. Rollback: set
`TOKEN_PRUNING=false`; the indexes are harmless with the old code.

## Open Questions

None.

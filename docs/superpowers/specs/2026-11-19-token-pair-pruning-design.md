---
comet_change: token-pair-pruning
role: technical-design
canonical_spec: openspec
---

# Token pair pruning: technical design

The OpenSpec change `token-pair-pruning` is the source of the requirements. This document gives the
implementation detail.

## 1. Configuration

`Config` gets one field:

```ts
tokenPruningKeep: number | null; // null: pruning is off
```

`loadConfig` reads two variables:

| Variable | Accepted values | Default | Invalid value |
|---|---|---|---|
| `TOKEN_PRUNING` | `true`, `false` (after trim) | `true` when unset or empty | throws `TOKEN_PRUNING must be "true" or "false"` |
| `TOKEN_PRUNING_KEEP` | decimal positive integer (`/^[1-9]\d*$/`, safe integer) | `5` when unset or empty | throws `TOKEN_PRUNING_KEEP must be a positive integer` |

The server parses `TOKEN_PRUNING_KEEP` also when pruning is off, so a bad value fails at start in
both cases. `server.ts` already calls `loadConfig` at start; no change is necessary there.

## 2. Used pairs and pruning in `issuePair`

New nullable column `token_pairs.refreshed_at timestamptz`. A pair is "used" when it is not
null.

`IssueInput` gets an optional `refreshedPairId?: number`. `refresh()` passes the id of the
presented pair. `issuePair` runs in one transaction:

1. If `refreshedPairId` is set: `update token_pairs set refreshed_at = $now where id = $id and
   refreshed_at is null`. A second use of the same refresh token keeps the first time.
2. Insert the new pair.
3. If `config.tokenPruningKeep` is not `null`, run:

```sql
delete from token_pairs
where application_id = $app and user_id = $user
  and refreshed_at is not null
  and access_expires_at <= $now
  and id not in (
    select id from token_pairs
    where application_id = $app and user_id = $user and refreshed_at is not null
    order by created_at desc, id desc
    limit $keep)
```

`$now` is `new Date(Date.now())`, the same clock that sets the expiry. Fake timers in tests then
control both values.

The update runs before the delete, so the pair that was just refreshed counts as used in the same
transaction. The new pair is not used, so the `DELETE` never removes it.

`created_at` uses the database default `now()`, the transaction start time. Within one owner the
order of used pairs by `created_at, id` is the issue order, except for transactions that run at
the same moment; those pairs still have a live access token, so the order does not matter.

Two issues at the same moment for one owner each see their own snapshot. The worst case is one
more used pair than `keep`, never fewer.

`rest.authorize` and event auth do not pass `refreshedPairId`.

Review follow-ups (second code review):

- `IssueInput.markUsed`: event auth sets it when it does not deliver the refresh token
  (`sendRefreshToken` is not `1`). The pair is inserted with `refreshed_at = $now`.
- Step 1 is `update ... set refreshed_at = coalesce(refreshed_at, $now) where id = $id returning
  id`. No row back means the pair was pruned after `refresh()` read it: `fail('invalid_grant')`
  rolls back the transaction.
- Partial index `token_pairs_used_app_user_created_idx` on `(application_id, user_id,
  created_at) where refreshed_at is not null` serves the prune query.

## 3. Indexes

Declared in `src/schema.ts`:

| Name | Table | Columns | Serves |
|---|---|---|---|
| `token_pairs_app_user_created_idx` | `token_pairs` | `application_id, user_id, created_at` | prune query; `ON DELETE CASCADE` from `applications` |
| `token_pairs_created_at_idx` | `token_pairs` | `created_at` | admin token list sort |
| `applications_portal_id_idx` | `applications` | `portal_id` | `ON DELETE CASCADE` from `portals`; admin join and count |

`npm run db:generate` writes `drizzle/0003_<name>.sql` and its snapshot. The column goes in the
same migration: `ALTER TABLE token_pairs ADD COLUMN refreshed_at timestamptz` (nullable, no
default, so PostgreSQL does not rewrite the table). Migrations run at start.

## 4. Error handling

- An invalid variable stops the process at start through the thrown error in `loadConfig`.
- If the `DELETE` fails, the transaction rolls back and the request fails like any other database
  error. No pair is issued in that case.

## 5. Tests

Unit, `test/unit/config.test.ts`:

- unset or empty: `tokenPruningKeep` is `5`;
- `TOKEN_PRUNING=false`: `null`;
- `TOKEN_PRUNING_KEEP=2`: `2`;
- `TOKEN_PRUNING` in `TRUE`, `yes`, `1`: throws with the variable name;
- `TOKEN_PRUNING_KEEP` in `0`, `-1`, `abc`, `1.5`: throws with the variable name.

Integration, `test/integration/token-service.test.ts`, fake `Date`. A "chain" is one
`rest.authorize` followed by refreshes, each refresh with the newest refresh token.

- Old used pairs are deleted: a chain of 6 refreshes, move time past one hour, one more refresh.
  7 used pairs exist; the 2 oldest are gone; the first refresh token gets `invalid_grant`; the
  third still works.
- Unused pairs are kept: one `rest.authorize` (the backend pair), then a chain of 10 refreshes
  from a second `rest.authorize`, time moved past one hour before the last refresh. The backend
  pair stays and its refresh token works.
- Live access tokens are kept: a chain of 7 refreshes inside one hour. All 8 pairs stay.
- Other users and applications: each other owner has a chain with more than 5 expired used
  pairs. One refresh for the first owner leaves them as they are.
- Pruning off: the setup of the first test deletes no pair.

`startApp` gets an optional `config` that replaces `TEST_CONFIG`. `TEST_CONFIG` gets
`tokenPruningKeep: 5`.

## 6. Documentation

- `docs/deployment.md`: two rows in the variable table and one sentence on invalid values.
- `README.md` and the five translations: two rows in the variable table and a short note that
  `TOKEN_PRUNING=false` keeps every pair as the Bitrix24 cloud does.

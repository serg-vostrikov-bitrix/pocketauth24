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

## 2. Pruning in `issuePair`

`issuePair` runs in one transaction:

1. Insert the new pair (unchanged).
2. If `config.tokenPruningKeep` is not `null`, run:

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

`$now` is `new Date(Date.now())`, the same clock that sets the expiry. Fake timers in tests then
control both values.

The subquery sees the new row, because it runs in the same transaction after the insert. The new
row has a live access token, so the `DELETE` never removes it.

`created_at` uses the database default `now()`, which is the transaction start time in
PostgreSQL. Two pairs from one transaction can have the same `created_at`; `id desc` breaks the
tie, and `id` grows with each insert.

Callers (`rest.authorize`, event auth, refresh) do not change.

## 3. Indexes

Declared in `src/schema.ts`:

| Name | Table | Columns | Serves |
|---|---|---|---|
| `token_pairs_app_user_created_idx` | `token_pairs` | `application_id, user_id, created_at` | prune query; `ON DELETE CASCADE` from `applications` |
| `token_pairs_created_at_idx` | `token_pairs` | `created_at` | admin token list sort |
| `applications_portal_id_idx` | `applications` | `portal_id` | `ON DELETE CASCADE` from `portals`; admin join and count |

`npm run db:generate` writes `drizzle/0003_<name>.sql` and its snapshot. Migrations run at start.

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

Integration, `test/integration/token-service.test.ts`, fake `Date`:

- keep 5: issue 5 pairs, move time past one hour, issue one more. The first pair is gone and its
  refresh token gets `invalid_grant`; 5 pairs remain.
- keep 5: issue 7 pairs inside one hour, issue one more. All 8 stay.
- other user (other `LOCAL_USER`) and other application keep their expired pairs. Each of them
  has more than 5 expired pairs before the new issue, so an unscoped `DELETE` would remove them.
- pruning off (`tokenPruningKeep: null`): the same setup as the first test (5 expired pairs, then
  one more issue) deletes no pair. The setup must be one that deletes with pruning on, so the test
  cannot pass for an unrelated reason.

The invalid-value cases are one `it.each` table per variable, not one test per value.

`startApp` gets an optional `config` that replaces `TEST_CONFIG`. `TEST_CONFIG` gets
`tokenPruningKeep: 5`.

## 6. Documentation

- `docs/deployment.md`: two rows in the variable table and one sentence on invalid values.
- `README.md` and the five translations: two rows in the variable table and a short note that
  `TOKEN_PRUNING=false` keeps every pair as the Bitrix24 cloud does.

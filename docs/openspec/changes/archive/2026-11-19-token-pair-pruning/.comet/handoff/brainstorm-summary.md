# Brainstorm Summary

- Change: token-pair-pruning
- Date: 2026-11-19

## Confirmed Technical Approach

- `Config.tokenPruningKeep: number | null` (`null` = pruning off), parsed from `TOKEN_PRUNING`
  (`true`/`false`, default `true`) and `TOKEN_PRUNING_KEEP` (positive integer, default 5).
  Invalid values stop the server at start.
- `issuePair` runs the insert and the prune `DELETE` in one transaction. The `DELETE` targets pairs
  of the same `application_id` and `user_id` with `access_expires_at <= now` and an `id` outside
  the newest `keep` pairs (`created_at desc, id desc`). `now` comes from app code.
- Three indexes declared in `src/schema.ts`; `drizzle-kit generate` writes migration 0003.

## Key Trade-offs and Risks

- Old refresh tokens outside the newest pairs stop working; `TOKEN_PRUNING=false` restores cloud behaviour.
- Plain `CREATE INDEX` blocks writes briefly at start; tables are small today.

## Testing Strategy

- Unit: `loadConfig` defaults, `false`, invalid values.
- Integration with fake `Date`: expired pairs pruned and their refresh gets `invalid_grant`; live
  pairs kept; other users and apps untouched; pruning off deletes nothing. `startApp` takes an
  optional `config`.

## Spec Patches

None.

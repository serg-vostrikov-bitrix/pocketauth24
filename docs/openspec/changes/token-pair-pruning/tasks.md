## 1. Configuration

- [x] 1.1 Add `TOKEN_PRUNING` and `TOKEN_PRUNING_KEEP` parsing to `loadConfig` (`Config.tokenPruningKeep: number | null`), with unit tests for defaults, `false`, and invalid values

## 2. Pruning

- [x] 2.1 Delete old pairs with an expired access token in `issuePair` after the insert, when `tokenPruningKeep` is not `null`
- [x] 2.2 Add integration tests: old expired pairs deleted and their refresh token gets `invalid_grant`; live pairs kept; other users and applications untouched; pruning off deletes nothing

## 3. Indexes

- [x] 3.1 Declare the three indexes in `src/schema.ts` and generate the Drizzle migration `drizzle/0003_*.sql`
- [x] 3.2 Check that migrations apply on a clean database and on the current schema

## 4. Documentation

- [x] 4.1 Add both variables to `docs/deployment.md`
- [x] 4.2 Add both variables to `README.md` with the note on cloud behaviour, and the same change to the five translations

# Design review: marketplace-partner-apps

## Ponytail

| Finding | Action |
| --- | --- |
| `setWhere` guard and reason `client_id_is_local` protect a conflict with a local row that real Marketplace codes cannot cause | Removed the guard, the reason and its test |
| Default `VERSION` = 1 for a field the portal always sends | `VERSION` is required in the schema; the default and its test are gone |
| `src/marketplace.ts` as a separate module | Kept: the CLI and tests share it, and it keeps `cli.ts` free of SQL |

## Test audit

| Finding | Action |
| --- | --- |
| "Upsert replaces the secret" duplicates the rotation test | Removed; the rotation test owns the contract |
| "Local stays `L`" duplicates existing token tests | Removed |
| "Contract tests still pass" listed as a new test | Moved to a note: it is a run, not a test |
| Spec scenario "Database leak" for the catalog had no test | Added: the CLI add test checks that the stored hash is not the secret |
| Migration test over existing local rows | Kept: storage contract with a credible regression (constraint swap) |

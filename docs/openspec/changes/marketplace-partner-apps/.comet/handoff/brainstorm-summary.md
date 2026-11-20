# Brainstorm Summary

- Change: marketplace-partner-apps
- Date: 2026-11-20

## Confirmed Technical Approach

- New table `marketplace_apps` (`client_id` unique, `secret_hash`, `title`, `scope`). An install is an `applications` row with `marketplace_app_id` set and `secret_hash` null.
- `applications.client_id`: partial unique index for local rows; unique index on `(portal_id, client_id)`.
- Status `F` / `L` comes from the row kind in `tokenResponse` and `check`; event auth and `rest.authorize` pass the app to `issuePair`.
- `application.install`: upsert on `(portal_id, client_id)`, update only when `marketplace_app_id` matches the catalog id, else fail; `VERSION` echoed as integer, default 1.
- `refresh`: left join catalog, check `coalesce(catalog.secret_hash, applications.secret_hash)`.
- CLI `marketplace add | list | remove`, secret via hidden prompt or `--secret-stdin`, sha256 hash.

## Key Trade-offs and Risks

- `application.install` answer shape comes from portal code, not captured traffic; live test on a test portal needed before release.
- `marketplace remove` cascades to installs and tokens.

## Testing Strategy

Integration tests on real PostgreSQL with existing helpers: one test per delta-spec scenario, `ONAPPINSTALL` for an install row, migration over a database with local applications, CLI tests.

## Spec Patches

None.

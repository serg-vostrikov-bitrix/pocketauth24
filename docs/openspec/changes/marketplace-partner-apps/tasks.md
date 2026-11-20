## 1. Data model

- [x] 1.1 Add `marketplace_apps` and `applications.marketplace_app_id` to `src/schema.ts`; make `applications.secret_hash` nullable; replace the global unique on `applications.client_id` with the partial unique index for local rows and the unique index on `(portal_id, client_id)`
- [x] 1.2 Generate migration `drizzle/0004_marketplace_apps.sql` and check it on a database that already has local applications

## 2. Catalog CLI

- [ ] 2.1 Add `marketplace add` with hidden prompt and `--secret-stdin`, upsert by `client_id`
- [ ] 2.2 Add `marketplace list` (no secret, no hash) and `marketplace remove`
- [ ] 2.3 Tests: add, replace, list output without secrets, remove with cascade to installs and tokens

## 3. RPC methods

- [ ] 3.1 Implement `application.install`: catalog lookup, upsert of the install row, the result shape from the spec
- [ ] 3.2 Reject a `client_id` outside the catalog and `application.install.subscription` through `fail()` with the two reasons
- [ ] 3.3 Implement `application.uninstall` (idempotent, calling portal only)
- [ ] 3.4 Limit `application.update` and `application.delete` to local rows
- [ ] 3.5 Tests for each scenario in the `application-registry` delta spec, including the `request_failed` reasons

## 4. Tokens and events

- [ ] 4.1 Return `status` `F` for install rows and `L` for local rows in `rest.authorize`, `rest.check` and event auth
- [ ] 4.2 Check the catalog secret in `refresh` (D4)
- [ ] 4.3 Tests: authorize, check, renewal with the catalog secret, rotation, wrong secret, no cross-portal renewal, `ONAPPINSTALL` delivery for an install row

## 5. Admin panel

- [ ] 5.1 Make sure the applications view shows install rows and never shows a hash; add a test

## 6. Documentation

- [ ] 6.1 Add the two reasons to `docs/logging.md`
- [ ] 6.2 Add a partner section to `docs/deployment.md`: CLI commands, renewal at `server_endpoint`, effect of `marketplace remove`
- [ ] 6.3 Update the limits and features in `README.md` with Sepia, then the same change in the five translations

## 7. Verification

- [ ] 7.1 Run lint, type check and the full test suite
- [ ] 7.2 Install a real Marketplace application of the partner on a local test portal that uses PocketAuth24, or record in the verify report that this check was not possible

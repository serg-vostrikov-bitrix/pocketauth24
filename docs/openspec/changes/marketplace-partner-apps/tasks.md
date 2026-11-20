## 1. Data model

- [x] 1.1 Add `marketplace_apps` and `applications.marketplace_app_id` to `src/schema.ts`; make `applications.secret_hash` nullable; replace the global unique on `applications.client_id` with the partial unique index for local rows and the unique index on `(portal_id, client_id)` <!-- comet-task:6cdf7094-5cd9-4bad-a7a1-ff2e74deddbd -->
- [x] 1.2 Generate migration `drizzle/0004_marketplace_apps.sql` and check it on a database that already has local applications <!-- comet-task:756e369c-62c2-4be8-8b28-c7eb0712374b -->

## 2. Catalog CLI

- [x] 2.1 Add `marketplace add` with hidden prompt and `--secret-stdin`, upsert by `client_id` <!-- comet-task:e6a01415-e645-4e47-8fab-eb63bc44125f -->
- [x] 2.2 Add `marketplace list` (no secret, no hash) and `marketplace remove` <!-- comet-task:a2f4bacb-e0f5-4328-8389-1cb2a60e0d14 -->
- [x] 2.3 Tests: add, replace, list output without secrets, remove with cascade to installs and tokens <!-- comet-task:fd8cc69c-aa54-4d43-b1fd-cc12f7c358d6 -->

## 3. RPC methods

- [x] 3.1 Implement `application.install`: catalog lookup, upsert of the install row, the result shape from the spec <!-- comet-task:9b113e7c-a90b-492d-b3ed-ad03dc8c3cb9 -->
- [x] 3.2 Reject a `client_id` outside the catalog and `application.install.subscription` through `fail()` with the two reasons <!-- comet-task:bfea99b8-5a4b-44aa-9a24-a2558b0a87fa -->
- [x] 3.3 Implement `application.uninstall` (idempotent, calling portal only) <!-- comet-task:41a50a05-5bc2-47ce-928a-702d019ea4d2 -->
- [x] 3.4 Limit `application.update` and `application.delete` to local rows <!-- comet-task:d7735ad3-d6b5-4dce-be4f-51655c799cde -->
- [x] 3.5 Tests for each scenario in the `application-registry` delta spec, including the `request_failed` reasons <!-- comet-task:c7275654-2b49-4ec5-a15e-7b9d484a4be1 -->

## 4. Tokens and events

- [x] 4.1 Return `status` `F` for install rows and `L` for local rows in `rest.authorize`, `rest.check` and event auth <!-- comet-task:1dc56066-0f9c-47ab-88b1-04d4f483d53c -->
- [x] 4.2 Check the catalog secret in `refresh` (D4) <!-- comet-task:b2dbc691-6b55-474e-af7c-0aac4a67e6ed -->
- [x] 4.3 Tests: authorize, check, renewal with the catalog secret, rotation, wrong secret, no cross-portal renewal, `ONAPPINSTALL` delivery for an install row <!-- comet-task:88c99449-ac67-4781-94fd-eed36c4c6a03 -->

## 5. Admin panel

- [x] 5.1 Make sure the applications view shows install rows and never shows a hash; add a test <!-- comet-task:e757a5c9-3fda-4de9-a1d8-57c368c032b3 -->

## 6. Documentation

- [x] 6.1 Add the two reasons to `docs/logging.md` <!-- comet-task:300705f3-86eb-4ab2-9eb8-ad664d216ee0 -->
- [x] 6.2 Add a partner section to `docs/deployment.md`: CLI commands, renewal at `server_endpoint`, effect of `marketplace remove` <!-- comet-task:0078f3e6-29e7-4ebf-acae-e06a7ddd575d -->
- [x] 6.3 Update the limits and features in `README.md` with Sepia, then the same change in the five translations <!-- comet-task:6e39698c-d5ee-4ffa-a8af-93ecdbf38a22 -->

## 7. Verification

- [x] 7.1 Run lint, type check and the full test suite <!-- comet-task:d8991241-d9fb-4327-ad08-bbedca6d51ce -->
- [x] 7.2 Install a real Marketplace application of the partner on a local test portal that uses PocketAuth24, or record in the verify report that this check was not possible <!-- comet-task:5c67b688-1af8-488d-9021-90e2e9348240 -->

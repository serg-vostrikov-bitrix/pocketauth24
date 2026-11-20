# Security report: claude/partner-apps-service-integration-fa778c

Date: 2026-11-20. Pull request: #38. Method: the `security-review` skill on
`git diff origin/main...HEAD` (`src/`, `drizzle/0004_marketplace_apps.sql`, `test/`, and the
deleted project-scope Comet hook files). Docs and archived OpenSpec files are not code and were
not reviewed.

## Result

No findings. No issue reached the confidence threshold (8/10 or higher).

## Areas checked

1. **Authentication of the new RPC methods.** `application.install`,
   `application.install.subscription` and `application.uninstall` go through the shared
   `authenticate` hook in `src/routes/rpc.ts`. The hook checks the portal service credentials with
   a constant-time compare before the handler runs. `application.install` takes the title, scope
   and secret only from the catalog, never from the request body.
2. **Isolation between portals.** Every lookup of `applications` by `client_id` also filters on
   the calling portal. The install upsert targets `(portal_id, client_id)`. `update` and `delete`
   require a local row; `uninstall` requires an install row.
3. **Token renewal.** `/oauth/token/` finds the pair by the refresh-token hash, then checks the
   `client_id`, then the secret: the catalog hash if one exists, else the hash of the row. A row
   without a hash is rejected.
4. **Secrets and logs.** The CLI reads the catalog secret from a hidden prompt or stdin and stores
   only its sha256. `marketplace list` shows no secret and no hash. The database error wrapper
   prints no query parameters. The new log reasons hold no secret.
5. **SQL and migration.** All queries use bound parameters. The only raw SQL is a constant index
   predicate. `ON DELETE CASCADE` removes installs and tokens with a catalog entry.
6. **CLI input.** Strict argument parsing; arguments are used only as bound query values.
7. **Deleted Comet hook files.** Deletions only; no new attack surface.

## Accepted by design

- Any registered portal can install any catalog application, as in the cloud Marketplace. Its
  tokens stay limited to that portal and to the catalog scope.
- `CHECK_HASH` and `INSTALL_HASH` are ignored, because only free applications are supported.

# Security review: fix/20261119/admin-portal-app-count

Date: 2026-11-19
Scope: `git diff origin/main...HEAD` — `src/admin/dataRoutes.ts`, `test/integration/admin-data.test.ts`.

## Result

No findings.

- The new `sql` template gets only static schema objects: the `applications` and `portals` tables and the names of their columns. No request input reaches it.
- `sql.identifier()` quotes the column names as identifiers, so no raw text goes into the query.
- The column has `filter: 'none'`, so query-string filters do not touch this expression.

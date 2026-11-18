# Design Doc review: public-status-page

Date: 2026-11-18. Reviewed file: `docs/superpowers/specs/2026-11-18-public-status-page-design.md`.

## Ponytail

| # | Finding | Result |
|---|---|---|
| 1 | shrink: separate cached value plus in-flight promise in the status cache. Cache the promise itself; concurrency sharing comes free. | Changed |
| 2 | yagni: `now` and `ttlMs` parameters of `createStatusService` exist only for tests. | Removed; tests use observable behavior |
| 3 | delete: `generatedAt` field in `/api/status`. Not asked. | Removed |
| 4 | Check constraint on `event_counters.outcome` | Kept: one line, protects data integrity |
| 5 | Card stagger and value fade animations | Kept: the user asked for subtle animations |
| 6 | `X-Content-Type-Options`, `frame-ancestors` in headers | Kept: security, no cost |

## Test audit

| # | Finding | Result |
|---|---|---|
| 1 | Cache test needed a wrapped pool and a fake clock: production seams only tests use (gate question 4). | Rewritten: insert a portal between two calls and assert the stale count |
| 2 | Three counter outcomes as separate tests duplicate the setup. | Table-driven test for delivered and failed; dropped is one more assertion in the existing overload test |
| 3 | "No sensitive data" is a string search in the response. | Kept: security contract, the cheapest independent guard |
| 4 | "Health down" and "Status with database down" both use a dead pool. | Kept both (two endpoints, two contracts); share the fixture |
| 5 | "Health down" asserts a response time under 3 s. | Kept: it is the 2-second timeout contract; 1 s margin against flakiness |
| 6 | Spec scenario "Database down → gyroscope error color" has no automated test. | Accepted: visual; manual browser check before verify |
| 7 | Spec scenario "Closed network" | Covered indirectly by the CSP header test; the browser enforces `default-src 'self'` |

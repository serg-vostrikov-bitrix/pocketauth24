# Plan test audit: public-status-page

Date: 2026-11-18. Reviewed file: `docs/superpowers/plans/2026-11-18-public-status-page.md`.

| # | Test | Finding | Result |
|---|---|---|---|
| 1 | Status cache | Uses a fresh app per test, so each test has its own cache; the stale count is observable behavior | Kept |
| 2 | No sensitive values | `not.toMatch(/user/i)` is a broad string search; it guards the "no user IDs" contract and fails only if a field name with "user" appears | Kept: cheapest guard for a security contract |
| 3 | Status with database down | Asserts exactly one `status_query_failed` log line | Kept: the design requires one log line per computation |
| 4 | Static: no `index.html` → JSON 404 | Added by the plan, not in the Design Doc; covers the "no build" edge case from the design table | Kept |
| 5 | Counters | Table-driven delivered/failed; dropped added to the existing overload test | Kept, matches the design review |
| 6 | Frontend | No automated tests; typecheck, build, a search for external URLs in the build output, and a manual browser check | Accepted per Design Doc |

Plan notes accepted without change: `tasks.md` has the number 3.3 twice (artifacts are frozen after design, so the plan calls the second one "3.3 (serve)"); `web/` uses typecheck and Prettier without ESLint, as the Design Doc says.

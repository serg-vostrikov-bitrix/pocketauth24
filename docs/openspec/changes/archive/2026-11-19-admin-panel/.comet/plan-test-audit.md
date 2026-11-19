# Plan test audit: admin-panel

Date: 2026-11-18. Reviewed file: `docs/superpowers/plans/2026-11-18-admin-panel.md`.

| # | Test | Finding | Result |
|---|---|---|---|
| 1 | Cookie flags (Task 4) | Did not assert `Secure`; the `admin-auth` spec requires it always | Plan changed: cookie always `Secure`, test asserts it (spec governs over the Design Doc's production-only flag) |
| 2 | Rate limiter window (Task 5) | Uses `vi.useFakeTimers`, no production seam | Kept |
| 3 | "Data routes need a session" (Task 7) | Looks like a duplicate of the auth 401 test, but guards a different risk: data routes registered outside the authenticated scope | Kept |
| 4 | "Form-encoded POST /users gets 415" (Task 6) | Same scope risk for the users routes | Kept |
| 5 | CLI tests spawn a process (Task 3) | Real boundary; slow but bounded timeouts | Kept |
| 6 | "The data API has no write routes" (Task 8) | Covers the "only GET endpoints" requirement | Kept |
| 7 | Admin UI (Tasks 9–11) | No web test runner by design | Manual browser check by the coordinator |

Plan-level decisions accepted from the planner: the CLI keeps the current superuser login without `--login` (spec text); scrypt via a Promise wrapper; events sorted by `day desc, outcome asc`; error bodies `unsupported_media_type`, `invalid_login`, `login_taken`, `not_found`; `id` filters limited to 9 digits.

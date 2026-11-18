# Design Doc review: admin-panel

Date: 2026-11-18. Reviewed file: `docs/superpowers/specs/2026-11-18-admin-panel-design.md`.

## Ponytail

| # | Finding | Result |
|---|---|---|
| 1 | yagni: `now` parameter of `createLoginLimiter` exists only for a test clock. | Removed; the limiter uses `Date.now()`; window expiry is not tested |
| 2 | delete: special "Not available" page for a viewer who opens `/admin/users`. The server already returns 403. | Removed; the route falls back to `portals` |
| 3 | Nine files under `src/admin` | Kept: each has one responsibility; the CLI reuses `users.ts` and `password.ts` |
| 4 | Narrow-screen top bar | Kept: one media query |
| 5 | `DUMMY_HASH` timing equalization | Kept: cheap, closes login enumeration |
| 6 | Login format check in both CLI and API | Kept: one shared regular expression |

## Test audit

| # | Finding | Result |
|---|---|---|
| 1 | "401 without a session" appeared in the data tests; the session check belongs to auth. | Moved to `admin-auth.test.ts` as "no cookie on a protected route 401" |
| 2 | Spec "The admin API SHALL provide only GET endpoints" had no test. | Added: `DELETE /api/admin/tokens/1` returns 404 |
| 3 | Rate-limit window expiry needs a clock seam. | Not tested; the sixth-failure 429 covers the contract |
| 4 | CLI tested through a spawned process with `--password-stdin` | Kept: the real boundary; the hidden TTY prompt gets a manual check |
| 5 | Partial unique index for one superuser | Not tested separately; the database enforces it and the CLI updates instead of inserting |
| 6 | UI scenarios (dark theme, no edit controls, fade-in) | Manual browser check, as in public-status-page |

## Spec clarifications

The Comet runtime refused to regenerate the handoff after delta spec edits (artifacts are frozen by hash). The spec edits were reverted; the two user decisions are recorded in Design Doc section 9 instead.

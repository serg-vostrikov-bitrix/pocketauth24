# Verification report: admin-panel

- Date: 2026-11-19
- Branch: `feature/20261118/admin-panel`, range `576b9e6..HEAD`
- Mode: full (3 delta spec capabilities, many changed files)
- Result: **PASS**

## Summary

| Dimension | Result |
|---|---|
| Completeness | 21/21 tasks `[x]`; every requirement of `admin-auth`, `admin-users`, `admin-data-browser` implemented |
| Correctness | Every scenario covered by a test or a recorded manual check; no security issue found |
| Coherence | Follows design.md D1–D8 and the Design Doc; build-phase decisions recorded in Design Doc section 10 |

## Checks

| # | Check | Result |
|---|---|---|
| 1 | All tasks in `tasks.md` complete | PASS (21/21) |
| 2 | Implementation matches `design.md` | PASS; D5 and D6 superseded, recorded in Design Doc section 10 |
| 3 | Implementation matches the Design Doc | PASS; divergences recorded in section 10 |
| 4 | All spec scenarios pass | PASS |
| 5 | Proposal goals and impact satisfied | PASS (CLI, tables, auth, users, data browser, UI, docs) |
| 6 | Delta spec vs Design Doc drift | Drift in the Design Doc only → user chose Option A: "Implementation Divergence" section appended |
| 7 | Design Doc locatable | PASS (`docs/superpowers/specs/2026-11-18-admin-panel-design.md`, `comet_change: admin-panel`) |

## Fresh evidence (coordinator run in the verify phase)

| Command | Result |
|---|---|
| `npm test` | 19 files, 153/153 passed, exit 0 |
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run web:typecheck` | exit 0 |
| `npm run web:build` | exit 0; admin code in a separate lazy chunk |
| External URL scan of `web/dist` | none loaded; only library message strings |
| Hard-coded secret scan of the `src/` and `web/src/` diff | none |

## Manual checks

- Browser (coordinator, temporary database): login page with the CLI hint when no superuser exists; wrong password shows the message and the error color of the gyroscope; filters update the URL and show "No matching rows"; creating a viewer shows the one-time password dialog; a viewer has no Users menu and `/admin/users` falls back to Portals.
- Terminal (user): the hidden prompt shows nothing; mismatched passwords and a short password are rejected; a valid password is saved. Ctrl+C was not checked by hand.

## Reviews

`review_mode: thorough`. Every task had a task review. Fix rounds: Task 4 (guard phase, admin 404), Task 5 (limiter race, user decision 2026-11-19), Task 6 (huge ids), Task 7 (impossible dates), Task 11 (double submit), Task 12 (docs command). The final whole-branch review found two Important issues (CLI could print the scrypt hash; `X-Forwarded-For` spoofing with the usual nginx setting); both were fixed and re-reviewed.

## Accepted deviations (user decision, 2026-11-19)

| Severity | Finding | Decision |
|---|---|---|
| WARNING | Design Doc and OpenSpec design D5/D6 describe the earlier plan | Option A: Design Doc section 10 |
| WARNING | Dark theme and row fade-in verified by code only; Ctrl+C not checked by hand | Accepted; issue #17 |
| SUGGESTION | `--password-stdin` echoes on a TTY; date bounds rely on DB time zone UTC; test-only `size()`; nginx example note; weak injection test; case-sensitive logins | Accepted; issue #17 |

## Version

The user asked for a minor version bump before archive (2026-11-19): `package.json` 0.1.0 → 0.2.0. After the bump: `npm test` 153/153, `npm run build` and `npm run lint` exit 0.

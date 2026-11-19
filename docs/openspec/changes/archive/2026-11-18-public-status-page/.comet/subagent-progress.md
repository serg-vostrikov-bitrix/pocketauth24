# Subagent progress — public-status-page

- review_mode: standard
- tdd_mode: tdd
- Stage: done

## Per-task reviews

| Task | Risk signals | Result |
|---|---|---|
| 1 Event counters | schema migration, cross-module | Approved |
| 2 Health probe | public API change | Approved |
| 3 Status service | public endpoint, SQL, shared cache | 1 Important (build not run) → fix round 1 → addressed |
| 4 Serve the built UI | security headers, new dependency | Approved; `reply.header` deviation verified against @fastify/static 10 types |
| 5 Frontend skeleton | new dependencies, large diff | Approved |
| 6 Gyroscope | none | No review (standard mode); coordinator diff check |
| 7 Docker, CI, Dependabot | build/CI pipeline | Approved |
| 8 Documentation | implementer concerns | Approved |

Manual browser check (coordinator): dark theme, mockup layout, CSP and no-cache on `/`, four rings rotate (12/9/6/4 s), error color via `gyro--error`, green pills, card fade-in.

## Final whole-branch review

- Important #1 (overload path: one upsert per dropped item → pool exhaustion could break `/oauth/token`): fixed in 0ff489b, one upsert per batch, new test.
- Minor #2 (stale Database pill when API unreachable): fixed in 975c221, neutral `unknown`.
- Minor (README proxy sentence omitted status page paths): fixed in 975c221.
- Scoped re-review: all addressed, no new breakage.

## Accepted, deferred findings

- Status queries have no own timeout: a hanging DB fills the pool in ~20-30 s, then `/api/status` reports `degraded`. Follow-up candidate: race the queries against the probe timeout.
- `connectionTimeoutMillis: 2000` applies to all queries: intended; mention in release notes.
- @fastify/static dotfiles default: no effect with `wildcard: false`.
- Missing tests: `event_counter_failed` log, race-timer branch, network failure → `failed`, concurrent cache sharing. Low risk.
- TypeScript 7 in `web/` vs 6 in root: separate pinned packages.
- CI `container` job not yet run on Linux: check on the first PR run.
- Hand-maintained test-count badge.

## Final evidence (coordinator run)

`npm test` 67/67; `npm run typecheck`, `npm run build`, `npm run web:typecheck`, `npm run web:build`, `eslint .` clean.

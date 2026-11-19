# Verification report: token-pair-pruning

- Date: 2026-11-19
- Mode: full (40 files changed since base `6c449cc`)
- HEAD: `fc71c51`
- Backlog issue: https://github.com/serg-vostrikov-bitrix/pocketauth24/issues/28

## Summary

| Dimension | Status |
|---|---|
| Completeness | 10/10 tasks checked; 2/2 requirements implemented |
| Correctness | 13/13 scenarios covered by tests |
| Coherence | Design followed; one doc drift (index list) fixed in `fc71c51` |

## Commands (fresh run at `fc71c51`)

| Command | Result |
|---|---|
| `npm run build` | exit 0 |
| `npm test` | 19 files, 172/172 tests passed |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (ESLint and Prettier) |
| Migration 0003 on a clean test database | applied; all tests pass |

## Requirements and scenarios

### Token renewal for applications (MODIFIED)

| Scenario | Evidence |
|---|---|
| Successful renewal | existing renewal tests in `test/integration/token-service.test.ts` |
| Refresh token reused | existing test, unchanged behaviour |
| Refresh token expired, unknown or pruned | "Old used pairs are deleted" (pruned token gets `invalid_grant`) and existing expiry tests |
| Wrong application secret | existing test |
| Unsupported grant type | existing test |

### Pruning of old token pairs (ADDED)

| Scenario | Evidence |
|---|---|
| Old used pairs are deleted | `token-service.test.ts` "Old used pairs are deleted" |
| Unused pairs are kept | "Unused pairs are kept" (failed under the earlier "last X of all pairs" rule) |
| Event pairs without a refresh token are used | `event-delivery.test.ts` "Install event reaches a server-side app" |
| A repeat renewal keeps the first use | "A repeat refresh keeps the time of the first use" |
| Live access tokens are kept | "Live access tokens are kept" |
| Other users and applications are not touched | "Other users and applications are not touched" |
| Pruning is off | "when TOKEN_PRUNING=false" / "Pruning is off" |
| Invalid setting | `test/unit/config.test.ts` (`it.each` tables) |

The race "pair pruned between read and transaction" has no deterministic test. The code path is
`UPDATE ... RETURNING` with `invalid_grant` on zero rows (`src/tokens.ts`, `issuePair`).

## Design adherence

- D1 prune inside `issuePair`, one transaction: followed.
- D2 used-only pruning with an expired access token: followed; event pairs without a delivered
  refresh token are used from the start.
- D3 two environment variables, `Config.tokenPruningKeep`: followed.
- D4 indexes in one migration: followed, four indexes plus the `refreshed_at` column.
- Delta spec vs Design Doc: the build-phase scope change (used-only rule) is recorded in the
  Design Doc section 2 and in `.comet/handoff/code-review.md`. No contradiction.

## Security

- No hard-coded secrets in the diff.
- The prune `DELETE` is scoped by `application_id` and `user_id`; a test covers this.
- Pruning cannot delete a pair with a live access token or an unused delivered refresh token.

## Code review

Two passes, recorded in `docs/openspec/changes/token-pair-pruning/.comet/handoff/code-review.md`.
All Important findings fixed. Accepted Minor findings: index build lock at start, `keep + 1` rows
under concurrency, rank by issue time, mixed clocks in tests, rare deadlock between concurrent
prunes, re-run of the earlier unreleased 0003 on old dev databases.

## Result

PASS. No CRITICAL or IMPORTANT issues open.

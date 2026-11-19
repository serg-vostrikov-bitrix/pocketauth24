# Code review: token-pair-pruning

Date: 2026-11-19. Mode: `review_mode: standard`, two review passes.

## Pass 1 (6c449cc..b9ddeac)

| Finding | Severity | Action |
|---|---|---|
| "Last X of all pairs" deletes the refresh token a backend keeps after X page opens | Important | Fixed: prune only used pairs (`refreshed_at`), user decision. Commits 3581e3d, 69bd077, a62822e. |
| Plain `CREATE INDEX` blocks writes at start | Minor | Accepted: tables are small on current installs (design.md Risks). |
| Two concurrent issues can leave `keep + 1` rows | Minor | Accepted: never fewer than `keep`. |
| Tie-break comment incomplete | Minor | Fixed: comment rewritten with the used-only change. |

## Pass 2 (3581e3d..a62822e)

| Finding | Severity | Action |
|---|---|---|
| Event pairs without a delivered refresh token are never used, so never pruned | Important | Fixed: `markUsed`, commit f8c5853. |
| Prune query reads all pairs of an owner | Important | Fixed: partial index `token_pairs_used_app_user_created_idx`, commit f8c5853. |
| A pair pruned between read and transaction still gets a new pair | Important | Fixed: `UPDATE ... RETURNING` in the transaction, `invalid_grant` on 0 rows, commit f8c5853. No deterministic test: the race needs two transactions interleaved at one point. |
| Keep rank uses issue time, not use time | Minor | Accepted: matches the documented risk. |
| Dev databases with the earlier 0003 fail on re-run | Minor | Accepted: 0003 is unreleased; reset dev and test databases. |
| Repeat-use test missing | Minor | Fixed: "A repeat refresh keeps the time of the first use". |
| Tests mix fake `Date` and DB `now()` | Minor | Accepted: transactions run one after another in tests. |
| Possible deadlock between concurrent prunes of one owner | Minor | Accepted: low probability; existed before; revisit if seen. |

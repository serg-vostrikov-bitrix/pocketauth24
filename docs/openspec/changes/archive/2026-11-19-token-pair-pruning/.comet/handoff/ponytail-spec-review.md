# Ponytail spec review: token-pair-pruning

Date: 2026-11-19. Scope: proposal.md, design.md, specs/token-service/spec.md, tasks.md.

| Finding | Action |
|---|---|
| `TOKEN_PRUNING_KEEP` upper bound 1000 is arbitrary; nothing needs it | Cut. The value is now any positive integer. |
| `applications (portal_id)` index: the table is small | Kept. The user approved the index list; it is one line and serves two cascades and the admin count. |
| `token_pairs (created_at)` index serves only the admin sort, and admin optimization is out of scope | Kept. Issue #28 names it explicitly, and it is one line. |
| Two variables instead of one (`0` = off) | Kept. The user asked for a separate switch. |
| Scenario "Other users and applications are not touched" could look redundant | Kept. It is the one check that the `WHERE` clause is scoped. |

net: -1 requirement detail.
